import io
import logging
import numpy as np
from PIL import Image

from sm.engine.dataset import Dataset


SEL_DATASET_RAW_OPTICAL_IMAGE = 'SELECT optical_image from dataset WHERE id = %s'
UPD_DATASET_RAW_OPTICAL_IMAGE = 'update dataset set optical_image = %s, transform = %s WHERE id = %s'
DEL_DATASET_RAW_OPTICAL_IMAGE = 'update dataset set optical_image = NULL, transform = NULL WHERE id = %s'
UPD_DATASET_THUMB_OPTICAL_IMAGE = 'update dataset set thumbnail = %s WHERE id = %s'

IMG_URLS_BY_ID_SEL = ('SELECT iso_image_ids '
                      'FROM iso_image_metrics m '
                      'JOIN job j ON j.id = m.job_id '
                      'JOIN dataset d ON d.id = j.ds_id '
                      'WHERE ds_id = %s')

INS_OPTICAL_IMAGE = ('INSERT INTO optical_image (id, ds_id, type, zoom, width, height, transform) '
                     'VALUES (%s, %s, %s, %s, %s, %s, %s)')
SEL_OPTICAL_IMAGE = 'SELECT id FROM optical_image WHERE ds_id = %s'
SEL_OPTICAL_IMAGE_THUMBNAIL = 'SELECT thumbnail FROM dataset WHERE id = %s'
DEL_OPTICAL_IMAGE = 'DELETE FROM optical_image WHERE ds_id = %s'

# TODO: adjust when everyone owns a Retina display
VIEWPORT_WIDTH = 1000.0
VIEWPORT_HEIGHT = 500.0


logger = logging.getLogger('engine')


class OpticalImageType(object):
    SCALED = 'scaled'
    CLIPPED_TO_ION_IMAGE = 'clipped_to_ion_image'


def _annotation_image_shape(db, img_store, ds):
    logger.info('Querying annotation image shape for "%s" dataset...', ds.id)
    ion_img_id = db.select(IMG_URLS_BY_ID_SEL + ' LIMIT 1', params=(ds.id,))[0][0][0]
    storage_type = ds.get_ion_img_storage_type(db)
    result = img_store.get_image_by_id(storage_type, 'iso_image', ion_img_id).size
    logger.info('Annotation image shape for "{}" dataset is {}'.format(ds.id, result))
    return result


def _transform_image_to_ion_space(scan, transform_, dims, zoom):
    # zoom is relative to the web application viewport size and not to the ion image dimensions,
    # i.e. zoom = 1 is what the user sees by default, and zooming into the image triggers
    # fetching higher-resolution images from the server

    scale_factor = min(int(round(zoom * min(VIEWPORT_WIDTH / dims[0], VIEWPORT_HEIGHT / dims[1]))), 1)

    transform = np.array(transform_)
    assert transform.shape == (3, 3)
    transform = transform / transform[2, 2]
    transform[:, :2] /= scale_factor
    coeffs = transform.flat[:8]
    new_dims = dims[0] * scale_factor, dims[1] * scale_factor
    img = scan.transform(new_dims, Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    transform_to_ion_space = np.diag([1/scale_factor, 1/scale_factor, 1])

    return img, new_dims, transform_to_ion_space.tolist()


def _scale_image(scan, transform_, zoom):
    # zoom is relative to the web application viewport size and not to the ion image dimensions,
    # i.e. zoom = 1 is what the user sees by default, and zooming into the image triggers
    # fetching higher-resolution images from the server

    scale_factor = min(zoom * min(VIEWPORT_WIDTH / scan.width, VIEWPORT_HEIGHT / scan.height), 1)
    new_dims = int(round(scan.width * scale_factor)), int(round(scan.height * scale_factor))

    img = scan.resize(new_dims, True)

    transform_to_ion_space = np.linalg.pinv(np.array(transform_))
    transform_to_ion_space = np.dot(transform_to_ion_space, np.diag([1 / scale_factor, 1 / scale_factor, 1]))

    return img, new_dims, transform_to_ion_space.tolist()


def _save_jpeg(img):
    buf = io.BytesIO()
    img.save(buf, 'jpeg', quality=90)
    buf.seek(0)
    return buf


def _add_raw_optical_image(db, img_store, ds, img_id, transform):
    row = db.select_one(SEL_DATASET_RAW_OPTICAL_IMAGE, params=(ds.id,))
    if row:
        old_img_id = row[0]
        if old_img_id and old_img_id != img_id:
            img_store.delete_image_by_id('fs', 'raw_optical_image', old_img_id)
    db.alter(UPD_DATASET_RAW_OPTICAL_IMAGE, params=(img_id, transform, ds.id))


def _add_zoom_optical_images(db, img_store, ds, dims, img_id, optical_img, transform, zoom_levels):
    rows = []

    for zoom in zoom_levels:
        img, (width, height), transform_to_ion_space = _scale_image(optical_img, transform, zoom)
        buf = _save_jpeg(img)
        scaled_img_id = img_store.post_image('fs', 'optical_image', buf)
        rows.append((scaled_img_id, ds.id, OpticalImageType.SCALED,
                     zoom, width, height, transform_to_ion_space))

        img, (width, height), transform_to_ion_space = _transform_image_to_ion_space(optical_img, transform, dims, zoom)
        buf = _save_jpeg(img)
        scaled_img_id = img_store.post_image('fs', 'optical_image', buf)
        rows.append((scaled_img_id, ds.id, OpticalImageType.CLIPPED_TO_ION_IMAGE,
                     zoom, width, height, transform_to_ion_space))

    for row in db.select(SEL_OPTICAL_IMAGE, params=(ds.id,)):
        img_store.delete_image_by_id('fs', 'optical_image', row[0])

    db.alter(DEL_OPTICAL_IMAGE, params=(ds.id,))
    db.insert(INS_OPTICAL_IMAGE, rows=rows)


def _add_thumbnail_optical_image(db, img_store, ds, dims, optical_img, transform):
    THUMBNAIL_SIZE = 200, 200
    db.alter(UPD_DATASET_THUMB_OPTICAL_IMAGE, params=(None, ds.id,))
    img = _transform_image_to_ion_space(optical_img, transform, dims, zoom=1)[0]
    img.thumbnail(THUMBNAIL_SIZE, Image.ANTIALIAS)
    buf = _save_jpeg(img)
    img_thumb_id = img_store.post_image('fs', 'optical_image', buf)
    db.alter(UPD_DATASET_THUMB_OPTICAL_IMAGE, params=(img_thumb_id, ds.id,))


def add_optical_image(db, img_store, ds_id, img_id, transform, zoom_levels=(1, 2, 4, 8)):
    """ Generate scaled and transformed versions of the provided optical image + creates the thumbnail """
    ds = Dataset.load(db, ds_id)
    logger.info('Adding optical image to "%s" dataset', ds.id)

    dims = _annotation_image_shape(db, img_store, ds)
    print(img_id)
    optical_img = img_store.get_image_by_id('fs', 'raw_optical_image', img_id)

    _add_raw_optical_image(db, img_store, ds, img_id, transform)
    _add_zoom_optical_images(db, img_store, ds, dims, img_id, optical_img, transform, zoom_levels)
    _add_thumbnail_optical_image(db, img_store, ds, dims, optical_img, transform)


def del_optical_image(db, img_store, ds_id):
    """ Deletes raw and zoomed optical images from DB and FS"""
    ds = Dataset.load(db, ds_id)
    logger.info('Deleting optical image to "%s" dataset', ds.id)
    raw_img_id, = db.select_one(SEL_DATASET_RAW_OPTICAL_IMAGE, params=(ds.id,))
    if raw_img_id:
        img_store.delete_image_by_id('fs', 'raw_optical_image', raw_img_id)
    for row in db.select(SEL_OPTICAL_IMAGE, params=(ds.id,)):
        img_store.delete_image_by_id('fs', 'optical_image', row[0])
    thumbnail_img_id, = db.select_one(SEL_OPTICAL_IMAGE_THUMBNAIL, params=(ds.id,))
    if thumbnail_img_id:
        img_store.delete_image_by_id('fs', 'optical_image', thumbnail_img_id)
    db.alter(DEL_DATASET_RAW_OPTICAL_IMAGE, params=(ds.id,))
    db.alter(DEL_OPTICAL_IMAGE, params=(ds.id,))
    db.alter(UPD_DATASET_THUMB_OPTICAL_IMAGE, params=(None, ds.id,))
