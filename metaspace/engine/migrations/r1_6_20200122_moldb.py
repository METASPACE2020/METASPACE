import argparse
import logging
import os

import psycopg2

from sm.engine.util import SMConfig, init_loggers

logger = logging.getLogger('engine')


def dump_moldb_tables(db_config):
    logger.info('Dumping moldb tables to files')
    conn = psycopg2.connect(**db_config)
    curs = conn.cursor()

    with open('/tmp/molecular_db.csv', 'w') as stream:
        curs.copy_to(stream, 'molecular_db')

    with open('/tmp/molecule.csv', 'w') as stream:
        curs.copy_to(stream, 'molecule', columns=['db_id', 'mol_id', 'mol_name', 'sf'])

    conn.close()


def import_moldb_tables(db_config):
    logger.info('Importing moldb tables from files')
    conn = psycopg2.connect(**db_config)
    curs = conn.cursor()

    with open('/tmp/molecular_db.csv', 'r') as stream:
        curs.copy_from(stream, 'molecular_db')

    with open('/tmp/molecule.csv', 'r') as stream:
        curs.copy_from(stream, 'molecule', columns=['moldb_id', 'mol_id', 'mol_name', 'formula'])

    conn.commit()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description='Migrate MolDB data from service to database')
    parser.add_argument('--config', default='conf/config.json', help='SM config path')
    args = parser.parse_args()

    SMConfig.set_path(args.config)
    config = SMConfig.get_conf()
    init_loggers(config['logs'])

    moldb_db_config = {'host': 'localhost', 'database': 'mol_db', 'user': 'mol_db'}
    dump_moldb_tables(moldb_db_config)

    import_moldb_tables(config['db'])

    os.remove('/tmp/molecule.csv')
    os.remove('/tmp/molecular_db.csv')


if __name__ == '__main__':
    main()
