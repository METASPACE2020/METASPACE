#!/usr/bin/env python
import argparse
import logging
import signal
import sys
from functools import partial
from multiprocessing.process import parent_process
from threading import Timer

from sm.engine.daemons.lithops import LithopsDaemon
from sm.engine.db import DB, ConnectionPool
from sm.engine.es_export import ESExporter
from sm.engine.image_store import ImageStoreServiceWrapper
from sm.engine.daemons.update import SMUpdateDaemon
from sm.engine.daemons.annotate import SMAnnotateDaemon
from sm.engine.daemons.dataset_manager import DatasetManager
from sm.engine.queue import (
    SM_ANNOTATE,
    SM_UPDATE,
    SM_LITHOPS,
    SM_DS_STATUS,
    QueuePublisher,
    QueueConsumer,
)
from sm.engine.config import init_loggers, SMConfig


def get_manager():
    db = DB()
    status_queue_pub = QueuePublisher(
        config=sm_config['rabbitmq'], qdesc=SM_DS_STATUS, logger=logger
    )
    return DatasetManager(
        db=db,
        es=ESExporter(db, sm_config),
        img_store=ImageStoreServiceWrapper(sm_config['services']['img_service_url']),
        status_queue=status_queue_pub,
        logger=logger,
    )


def main(daemon_name, exit_after):
    logger.info(f'Starting {daemon_name}-daemon')

    conn_pool = ConnectionPool(sm_config['db'])

    daemons = []
    if daemon_name == 'annotate':
        daemons.append(
            SMAnnotateDaemon(manager=get_manager(), annot_qdesc=SM_ANNOTATE, upd_qdesc=SM_UPDATE)
        )
    elif daemon_name == 'update':
        make_update_queue_cons = partial(
            QueueConsumer,
            config=sm_config['rabbitmq'],
            qdesc=SM_UPDATE,
            logger=logger,
            poll_interval=1,
        )
        for _ in range(sm_config['services']['update_daemon_threads']):
            daemon = SMUpdateDaemon(get_manager(), make_update_queue_cons)
            daemons.append(daemon)
    elif daemon_name == 'lithops':
        daemon = LithopsDaemon(
            get_manager(), lit_qdesc=SM_LITHOPS, annot_qdesc=SM_ANNOTATE, upd_qdesc=SM_UPDATE
        )
        daemons.append(daemon)
    else:
        raise Exception(f'Wrong SM daemon name: {daemon_name}')

    def cb_stop_daemons(*args):  # pylint: disable=redefined-outer-name
        if parent_process() is not None:
            # Multiprocessing worker processes (used by Lithops) inherit this signal handler.
            # Avoid interacting with the queues from a worker process as they aren't functional
            return
        logger.info(f'Stopping {daemon_name}-daemon')
        for d in daemons:  # pylint: disable=invalid-name
            d.stop()
        conn_pool.close()
        sys.exit(1)

    signal.signal(signal.SIGINT, cb_stop_daemons)
    signal.signal(signal.SIGTERM, cb_stop_daemons)

    if exit_after is not None:
        exit_timer = Timer(exit_after, cb_stop_daemons)
        exit_timer.setDaemon(True)  # Don't prevent shutdown if the timer is still running
        exit_timer.start()

    for daemon in daemons:
        daemon.start()

    for daemon in daemons:
        daemon.join()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='A daemon process for consuming messages from a '
        'queue and performing dataset manipulations'
    )
    parser.add_argument('--name', type=str, help='SM daemon name (annotate/update/lithops)')
    parser.add_argument(
        '--config', dest='config_path', default='conf/config.json', type=str, help='SM config path'
    )
    parser.add_argument(
        '--exit-after', type=float, help='Exits gracefully with an exitcode after N seconds',
    )
    args = parser.parse_args()

    SMConfig.set_path(args.config_path)
    sm_config = SMConfig.get_conf()
    init_loggers(sm_config['logs'])
    logger = logging.getLogger(f'{args.name}-daemon')

    main(args.name, args.exit_after)
