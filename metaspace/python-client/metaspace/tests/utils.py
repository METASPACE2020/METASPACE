from pathlib import Path
import pytest

from metaspace.sm_annotation_utils import SMInstance


@pytest.fixture()
def sm():
    return SMInstance(config_path=(Path(__file__).parent / '../../test_config').resolve())


@pytest.fixture()
def my_ds_id(sm):
    user_id = sm.current_user_id()
    datasets = sm.get_metadata({'submitter': user_id, 'status': 'FINISHED'})
    return datasets.index[0]
