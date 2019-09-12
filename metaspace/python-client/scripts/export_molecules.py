from pathlib import Path
import logging
import argparse

from metaspace.annotation_export import (
    init_logger,
    convert_url_to_filter_args,
    fetch_graphql_res,
    convert_to_dfs,
    calculate_ann_stat,
    export_molecules
)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Run molecule export')
    parser.add_argument('--path', default='.', help='Export path')
    parser.add_argument('--url', type=str, help='Metaspace URL')
    args = parser.parse_args()

    url = args.url
    path = Path(args.path)

    init_logger(logging.DEBUG)

    filter_args = convert_url_to_filter_args(url)
    graphql_res = fetch_graphql_res(filter_args)
    ann_df, mol_df = convert_to_dfs(graphql_res)
    ann_stat_df = calculate_ann_stat(ann_df)
    export_molecules(ann_stat_df, mol_df, path)
