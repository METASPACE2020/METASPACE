from itertools import product
from unittest.mock import call
from unittest.mock import patch, MagicMock
from datetime import datetime

import numpy as np

from sm.engine.sm_daemons import DatasetManager
from sm.engine.db import DB
from sm.engine.es_export import ESExporter
from sm.engine.queue import QueuePublisher
from sm.engine.dataset import DatasetStatus, Dataset, generate_ds_config
from sm.engine.png_generator import ImageStoreServiceWrapper
from sm.engine.tests.util import (
    sm_config,
    test_db,
    fill_db,
    sm_index,
    es_dsl_search,
    metadata,
    ds_config,
)

mol_db_mock = {'id': 1, 'name': 'HMDB-v4', 'version': '2001-01-01'}


def create_ds(
    ds_id='2000-01-01',
    ds_name='ds_name',
    input_path='input_path',
    upload_dt=None,
    metadata=None,
    status=DatasetStatus.QUEUED,
    mol_dbs=None,
    adducts=None,
):
    upload_dt = upload_dt or datetime.now()
    if not mol_dbs:
        mol_dbs = ['HMDB-v4']
    if not adducts:
        adducts = ['+H', '+Na', '+K', '[M]+']
    if not metadata:
        metadata = {
            'MS_Analysis': {
                'Polarity': 'Positive',
                'Analyzer': 'FTICR',
                'Detector_Resolving_Power': {'mz': 200, 'Resolving_Power': 140000},
            }
        }
    config = generate_ds_config(metadata, mol_dbs=mol_dbs, adducts=adducts)
    return Dataset(
        id=ds_id,
        name=ds_name,
        input_path=input_path,
        upload_dt=upload_dt,
        metadata=metadata or {},
        config=config,
        status=status,
        img_storage_type='fs',
    )


def create_daemon_man(db=None, es=None, img_store=None, status_queue=None):
    db = db or DB()
    es_mock = es or MagicMock(spec=ESExporter)
    status_queue_mock = status_queue or MagicMock(QueuePublisher)
    img_store_mock = img_store or MagicMock(spec=ImageStoreServiceWrapper)
    img_store_mock.get_ion_images_for_analysis.return_value = (
        [np.zeros((2, 2)), np.zeros((2, 2))],
        None,
        (2, 2),
    )

    return DatasetManager(
        db=db, es=es_mock, img_store=img_store_mock, status_queue=status_queue_mock
    )


class TestSMDaemonDatasetManager:
    class SearchJob:
        def __init__(self, *args, **kwargs):
            pass

        def run(self, *args, **kwargs):
            pass

    def test_annotate_ds(self, fill_db, metadata, ds_config):
        es_mock = MagicMock(spec=ESExporter)
        db = DB()
        manager = create_daemon_man(db=db, es=es_mock)

        ds_id = '2000-01-01'
        ds_name = 'ds_name'
        input_path = 'input_path'
        upload_dt = datetime.now()
        ds = create_ds(
            ds_id=ds_id,
            ds_name=ds_name,
            input_path=input_path,
            upload_dt=upload_dt,
            metadata=metadata,
        )

        manager.annotate(ds, annotation_job_factory=self.SearchJob)

        DS_SEL = 'select name, input_path, upload_dt, metadata, config from dataset where id=%s'
        results = db.select_one(DS_SEL, params=(ds_id,))
        assert results[3] == metadata
        assert results[4] == ds_config
        # assert db.select_one(DS_SEL, params=(ds_id,)) == (ds_name, input_path, upload_dt, metadata, ds_config)

    def test_index_ds(self, fill_db, metadata):
        es_mock = MagicMock(spec=ESExporter)
        manager = create_daemon_man(es=es_mock)

        ds_id = '2000-01-01'
        ds = create_ds(ds_id=ds_id, metadata=metadata)

        with patch('sm.engine.sm_daemons.MolecularDB') as MolecularDB:
            molecular_db_mock = MolecularDB.return_value
            molecular_db_mock.name = 'HMDB-v4'

            manager.index(ds)

            es_mock.delete_ds.assert_called_with(ds_id, delete_dataset=False)
            call_args = es_mock.index_ds.call_args[1].values()
            assert ds_id in call_args and molecular_db_mock in call_args

    def test_delete_ds(self, fill_db):
        db = DB()
        es_mock = MagicMock(spec=ESExporter)
        img_store_service_mock = MagicMock(spec=ImageStoreServiceWrapper)
        manager = create_daemon_man(db=db, es=es_mock, img_store=img_store_service_mock)

        ds_id = '2000-01-01'
        ds = create_ds(ds_id=ds_id)

        manager.delete(ds)

        ids = [f'iso_image_{i}{j}' for i, j in product([1, 2], [1, 2])]
        img_store_service_mock.delete_image_by_id.assert_has_calls(
            [call('fs', 'iso_image', ids[0]), call('fs', 'iso_image', ids[1])]
        )
        es_mock.delete_ds.assert_called_with(ds_id)
        assert db.select_one('SELECT * FROM dataset WHERE id = %s', params=(ds_id,)) == []
