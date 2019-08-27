import argparse

from sm.engine.util import SMConfig, init_loggers
from sm.engine.es_export import ESIndexManager


def print_status(es_man, alias):
    active_index = es_man.internal_index_name(alias)
    inactive_index = es_man.another_index_name(active_index)

    if es_man.exists_index(active_index):
        active_count, active_size = es_man.get_index_stats(active_index)
        print(f'Active index {alias} -> {active_index}: {active_count} docs, {active_size / 2**20:f}MiB')
    else:
        print(f'Active index {alias} -> {active_index}: MISSING')

    if es_man.exists_index(inactive_index):
        inactive_count, inactive_size = es_man.get_index_stats(inactive_index)
        print(f'Inactive index {inactive_index}: {inactive_count} docs, {inactive_size / 2**20:f}MiB')
    else:
        print(f'Inactive index {inactive_index}: NOT PRESENT')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Create ElasticSearch indices')
    parser.add_argument('--config', dest='config_path', default='conf/config.json', help='SM config path')
    parser.add_argument('--inactive', action='store_true', help='Run on the inactive index')
    subparsers = parser.add_subparsers(dest='action', description='create, swap, drop, status')

    create_subparser = subparsers.add_parser('create')
    create_subparser.add_argument('--drop', action='store_true', help='Delete existing index if exists')

    swap_subparser = subparsers.add_parser('swap', help='Swap the active and inactive indexes')
    drop_subparser = subparsers.add_parser('drop', help='Drop the index. Can only be used on the inactive index')
    status_subparser = subparsers.add_parser('status', help='Show current index mapping')

    args = parser.parse_args()

    SMConfig.set_path(args.config_path)
    init_loggers(SMConfig.get_conf()['logs'])

    es_config = SMConfig.get_conf()['elasticsearch']
    es_man = ESIndexManager(es_config)
    alias = es_config['index']
    active_index = es_man.internal_index_name(alias)
    inactive_index = es_man.another_index_name(active_index)
    index = inactive_index if args.inactive else active_index

    if args.action == 'create':
        if args.drop:
            es_man.delete_index(index)
        es_man.create_index(index)
        if not args.inactive:
            es_man.remap_alias(index, alias)
    elif args.action == 'swap':
        es_man.remap_alias(inactive_index, alias)
    elif args.action == 'drop':
        assert args.inactive, 'drop must be used with --inactive '
        es_man.delete_index(index)
    elif args.action == 'status':
        pass
    else:
        parser.error('Invalid action')

    # Print status regardless. The specific command just exists as a clean way to indicate to not do anything
    print_status(es_man, alias)
