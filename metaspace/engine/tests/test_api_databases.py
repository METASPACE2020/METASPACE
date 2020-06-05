import contextlib
import json
from unittest.mock import patch

import pytest

from sm.engine.db import DB
from sm.rest import api
from sm.rest.databases import MALFORMED_CSV
from sm.rest.utils import ALREADY_EXISTS

GROUP_ID = '123e4567-e89b-12d3-a456-426655440000'
MOLDB_COUNT_SEL = 'SELECT COUNT(*) FROM molecular_db'


@pytest.fixture()
def fill_db(test_db):
    db = DB()
    db.insert(
        'INSERT INTO graphql.group (id, name, short_name) VALUES (%s, %s, %s)',
        [(GROUP_ID, 'test-group', 'test-group')],
    )

    yield


def moldb_input_doc(**kwargs):
    return {
        'name': 'test-db',
        'version': '2000-01-01',
        'group_id': GROUP_ID,
        'file_path': 's3://sm-engine/tests/test-db-2.tsv',
        'description': 'Full database description',
        **kwargs,
    }


def moldb_upd_doc(**kwargs):
    return {
        'archived': False,
        'full_name': 'full database name',
        'link': 'http://example.org',
        'citation': 'database citation string',
        'description': 'Full database description',
        **kwargs,
    }


@contextlib.contextmanager
def patch_bottle_request(req_doc):
    with patch('sm.rest.api.bottle.request') as request_mock:
        request_mock.body.getvalue.return_value = json.dumps(req_doc).encode()
        yield req_doc


def test_create_moldb(fill_db):
    with patch_bottle_request(req_doc=moldb_input_doc()) as req_doc:

        resp = api.databases.create()

        assert resp['status'] == 'success'
        resp_doc = resp['data']

        db = DB()
        doc = db.select_one_with_fields(
            'SELECT id, name, version, group_id, public FROM molecular_db where id = %s',
            (resp_doc['id'],),
        )
        for field in ['name', 'version', 'group_id']:
            assert doc[field] == req_doc[field]
        assert doc['public'] is False

        docs = db.select_with_fields(
            'SELECT * FROM molecule WHERE moldb_id = %s', (resp_doc['id'],),
        )
        for doc in docs:
            print(doc)
            for field in ['mol_id', 'mol_name', 'formula', 'inchi']:
                assert field in doc


def test_create_moldb_duplicate(fill_db):
    with patch_bottle_request(req_doc=moldb_input_doc()) as req_doc:
        db = DB()
        db.insert(
            'INSERT INTO molecular_db (name, version, group_id) VALUES (%s, %s, %s)',
            [(req_doc['name'], req_doc['version'], req_doc['group_id'])],
        )

        resp = api.databases.create()

        assert resp['status'] == ALREADY_EXISTS['status']

        (db_count,) = db.select_one(MOLDB_COUNT_SEL)
        assert db_count == 1


@pytest.mark.parametrize(
    'file_path',
    [
        's3://sm-engine/tests/test-db-wrong-sep.csv',
        's3://sm-engine/tests/test-db-missing-columns.csv',
    ],
)
def test_create_moldb_malformed_csv(file_path, fill_db):
    with patch_bottle_request(req_doc=moldb_input_doc(file_path=file_path)):

        resp = api.databases.create()

        assert resp['status'] == MALFORMED_CSV['status']
        assert resp['errors']

        db = DB()
        (db_count,) = db.select_one(MOLDB_COUNT_SEL)
        assert db_count == 0


def test_create_moldb_wrong_formulas(fill_db):
    with patch_bottle_request(
        req_doc=moldb_input_doc(file_path='s3://sm-engine/tests/test-db-wrong-formulas.csv')
    ):

        resp = api.databases.create()

        assert resp['status'] == MALFORMED_CSV['status']
        assert resp['errors']
        for err_line in resp['errors'].split('\n')[1:]:
            for err_field in ['line', 'formula', 'error']:
                assert err_field in err_line

        db = DB()
        (db_count,) = db.select_one(MOLDB_COUNT_SEL)
        assert db_count == 0


def test_delete_moldb(fill_db):
    doc = moldb_input_doc()
    db = DB()
    (moldb_id,) = db.insert_return(
        'INSERT INTO molecular_db (name, version, group_id) VALUES (%s, %s, %s) RETURNING id',
        rows=[(doc['name'], doc['version'], doc['group_id'])],
    )
    with patch_bottle_request(req_doc={}):

        resp = api.databases.delete(moldb_id)

        assert resp['status'] == 'success'

        db = DB()
        (db_count,) = db.select_one(MOLDB_COUNT_SEL)
        assert db_count == 0


@pytest.mark.parametrize(
    ('archived_before', 'archived_after'), [(False, True), (True, False)],
)
def test_update_moldb(archived_before, archived_after, fill_db):
    doc = moldb_input_doc()
    doc['archived'] = False
    db = DB()
    (moldb_id,) = db.insert_return(
        'INSERT INTO molecular_db (name, version, group_id, archived) '
        'VALUES (%s, %s, %s, %s) RETURNING id',
        rows=[(doc['name'], doc['version'], doc['group_id'], doc['archived'])],
    )
    with patch_bottle_request(
        req_doc=moldb_upd_doc(archived=archived_after, description='New database description')
    ):
        resp = api.databases.update(moldb_id)

        assert resp['status'] == 'success'

        result_doc = db.select_one_with_fields(
            'SELECT * FROM molecular_db where id = %s', params=(moldb_id,),
        )
        assert result_doc['archived'] == archived_after
        assert result_doc['description'] == 'New database description'