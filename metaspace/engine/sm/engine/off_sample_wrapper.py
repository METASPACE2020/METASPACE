import base64
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial, wraps
from io import BytesIO
import random
from time import sleep
from PIL import Image
from requests import post, get
import numpy as np

from sm.engine.png_generator import ImageStoreServiceWrapper


logger = logging.getLogger('update-daemon')


def make_chunk_gen(items, chunk_size):
    chunk_n = (len(items) - 1) // chunk_size + 1
    chunks = [items[i * chunk_size : (i + 1) * chunk_size] for i in range(chunk_n)]
    for image_path_chunk in chunks:
        yield image_path_chunk


def encode_image_as_base64(img):
    fp = BytesIO()
    img.save(fp, format='PNG')
    fp.seek(0)
    return base64.b64encode(fp.read()).decode()


def base64_images_to_doc(images):
    images_doc = {'images': [{'content': content} for content in images]}
    return images_doc


def retry_on_error(num_retries=3):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for i in range(1, num_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    min_wait_time = 10 * i
                    delay = random.uniform(min_wait_time, min_wait_time + 5)
                    logger.warning(
                        f'Off-sample API error on attempt {i}. '
                        f'Retrying after {delay:.1f} seconds...'
                    )
                    sleep(delay)
            # Last attempt, don't catch the exception
            return func(*args, **kwargs)

        return wrapper

    return decorator


SEL_ION_IMAGES = (
    'select m.id as ann_id, iso_image_ids[1] as img_id '
    'from dataset d '
    'join job j on j.ds_id = d.id '
    'join annotation m on m.job_id = j.id '
    'where d.id = %s and (%s or m.off_sample is null)'
    'order by m.id '
)
UPD_OFF_SAMPLE = (
    'update annotation as row set off_sample = row2.off_sample::json '
    'from (values %s) as row2(id, off_sample) '
    'where row.id = row2.id; '
)


def numpy_to_pil(a):
    assert a.ndim > 1

    if a.ndim == 2:
        a_min, a_max = a.min(), a.max()
    else:
        a = a[:, :, :3]
        a_min, a_max = a.min(axis=(0, 1)), a.max(axis=(0, 1))

    a = ((a - a_min) / (a_max - a_min) * 255).astype(np.uint8)
    return Image.fromarray(a)


@retry_on_error(6)
def call_api(url='', doc=None):
    if doc:
        resp = post(url=url, json=doc, timeout=120)
    else:
        resp = get(url=url)
    if resp.status_code == 200:
        return resp.json()
    else:
        raise Exception(resp.content or resp)


def make_classify_images(api_endpoint, get_image):
    def classify(chunk):
        logger.debug('Classifying chunk of {} images'.format(len(chunk)))

        base64_images = []
        for elem in chunk:
            img = get_image(elem)
            base64_images.append(encode_image_as_base64(img))

        images_doc = base64_images_to_doc(base64_images)
        pred_doc = call_api(api_endpoint + '/predict', doc=images_doc)
        return pred_doc['predictions']

    def classify_items(items):
        logger.info('Off-sample classification of {} images'.format(len(items)))
        with ThreadPoolExecutor(8) as pool:
            chunk_it = make_chunk_gen(items, chunk_size=32)
            preds_list = pool.map(classify, chunk_it)
        image_predictions = [p for preds in preds_list for p in preds]
        return image_predictions

    return classify_items


def classify_dataset_ion_images(db, ds, services_config, overwrite_existing=False):
    off_sample_api_endpoint = services_config['off_sample']
    img_api_endpoint = services_config['img_service_url']

    image_store_service = ImageStoreServiceWrapper(img_api_endpoint)
    storage_type = ds.get_ion_img_storage_type(db)
    get_image_by_id = partial(image_store_service.get_image_by_id, storage_type, 'iso_image')

    annotations = db.select_with_fields(SEL_ION_IMAGES, (ds.id, overwrite_existing))
    image_ids = [a['img_id'] for a in annotations]

    classify_images = make_classify_images(off_sample_api_endpoint, get_image_by_id)
    image_predictions = classify_images(image_ids)

    rows = [(ann['ann_id'], json.dumps(pred)) for ann, pred in zip(annotations, image_predictions)]
    db.alter_many(UPD_OFF_SAMPLE, rows)
