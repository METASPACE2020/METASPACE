import argparse
from functools import partial

from sm.engine.db import DB
from sm.engine.optical_image import add_optical_image
from sm.engine.util import bootstrap_and_run
from sm.engine.png_generator import ImageStoreServiceWrapper


def update_optical_images(sm_config, logger, ds_id, sql_where):
    img_store = ImageStoreServiceWrapper(sm_config['services']['img_service_url'])
    db = DB()

    if ds_id:
        ds_ids = ds_id.split(',')
    else:
        ds_ids = [id for (id,) in db.select(f'SELECT DISTINCT dataset.id FROM dataset WHERE {sql_where}')]

    for i, ds_id in enumerate(ds_ids):
        try:
            transform, img_id = db.select_one(
                'SELECT transform, optical_image from dataset WHERE id = %s', params=(ds_id,)
            )
            if img_id and transform:
                logger.info(f'[{i + 1}/{len(ds_ids)}] Updating optical image of dataset {ds_id}')
                add_optical_image(db, img_store, ds_id, img_id, transform)
            else:
                logger.info(f'[{i + 1}/{len(ds_ids)}] Skipping dataset {ds_id}')
        except Exception:
            logger.error(f'Failed to update optical image on {ds_id}', exc_info=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Updates optical image copies for a provided dataset")
    parser.add_argument('--config', default='conf/config.json', help='SM config path')
    parser.add_argument('--ds-id', dest='ds_id', default='', help='DS id (or comma-separated list of ids)')
    parser.add_argument(
        '--sql-where',
        dest='sql_where',
        default=None,
        help='SQL WHERE clause for picking rows from the dataset table, '
        'e.g. "status = \'FINISHED\' and ion_thumbnail is null"',
    )
    args = parser.parse_args()

    if args.ds_id or args.sql_where:
        bootstrap_and_run(args.config, partial(update_optical_images, ds_id=args.ds_id, sql_where=args.sql_where))
    else:
        parser.print_help()
