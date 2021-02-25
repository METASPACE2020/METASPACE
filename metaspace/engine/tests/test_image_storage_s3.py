import io

import PIL.Image
import numpy as np
import botocore.exceptions
import pytest

from sm.engine import image_storage
from .utils import create_bucket

BUCKET_NAME = 'sm-image-storage-tests'


@pytest.fixture(autouse=True, scope='module')
def fill_storage():
    bucket = create_bucket(BUCKET_NAME)
    yield
    bucket.objects.all().delete()


def make_test_image_bytes() -> bytes:
    array = np.array([[0, 0], [1, 1], [2, 2]])
    image = PIL.Image.fromarray(array.astype(np.uint16))
    fp = io.BytesIO()
    image.save(fp, format='PNG')
    fp.seek(0)
    return fp.read()


def test_post_get_image_success():
    test_image_bytes = make_test_image_bytes()

    image_id = image_storage.post_image(image_storage.ImageType.ISO, "ds-id", test_image_bytes)
    fetched_image_bytes = image_storage.get_image(image_storage.ImageType.ISO, "ds-id", image_id)

    assert fetched_image_bytes == test_image_bytes


def test_post_get_image_wrong_key():
    try:
        image_storage.get_image(image_storage.ImageType.ISO, "ds-id", 'wrong-id')
    except botocore.exceptions.ClientError as error:
        assert error.response['Error']['Code'] == 'NoSuchKey'
