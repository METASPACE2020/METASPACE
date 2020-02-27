import logging

import pandas as pd
import psycopg2.errors
import bottle

from sm.engine.db import TransactionContext
from sm.engine import molecular_db
from sm.engine.molecular_db import import_molecules_from_df, MalformedCSV
from sm.rest.utils import (
    body_to_json,
    make_response,
    WRONG_PARAMETERS,
    OK,
    ALREADY_EXISTS,
    INTERNAL_ERROR,
)

MALFORMED_CSV = {'status_code': 400, 'status': 'malformed_csv'}

logger = logging.getLogger('api')
app = bottle.Bottle()


@app.post('/create')
def create():
    """Create a molecular database and import molecules.

    Body format: {
        name - database name
        version - database version
        group_id - UUID of group database belongs to
        file_path - S3 path to database import file (s3://bucket/path)
    }
    """
    params = None
    try:
        params = body_to_json(bottle.request)
        logger.info(f'Creating molecular database. Params: {params}')

        required_fields = ['name', 'version', 'group_id', 'file_path']
        if not all([field in params for field in required_fields]):
            return make_response(WRONG_PARAMETERS, data=f'Required fields: {required_fields}')

        with TransactionContext():
            moldb = molecular_db.create(
                params['name'], params['version'], params['group_id'], public=False
            )
            moldb_df = pd.read_csv(params['file_path'], sep='\t')
            import_molecules_from_df(moldb, moldb_df)
            # TODO: update "targeted" field

        return make_response(OK, data=moldb.to_dict())
    except psycopg2.errors.UniqueViolation:  # pylint: disable=no-member
        logger.exception(f'Database already exists. Params: {params}')
        return make_response(ALREADY_EXISTS)
    except MalformedCSV as e:
        logger.exception(f'Malformed CSV file. Params: {params}')
        return make_response(MALFORMED_CSV, errors=e.errors)
    except Exception:
        logger.exception(f'Server error. Params: {params}')
        return make_response(INTERNAL_ERROR)


@app.post('/<moldb_id>/delete')
def delete(moldb_id):
    """Delete the molecular database and all associated jobs."""
    try:
        logger.info(f'Deleting molecular database. ID: {moldb_id}')
        molecular_db.delete(moldb_id)
        return make_response(OK)
    except Exception:
        logger.exception(f'Server error. ID: {moldb_id}')
        return make_response(INTERNAL_ERROR)


@app.post('/<moldb_id>/update')
def update(moldb_id):
    """Update a molecular database.

    Body format: {
        archived: {true/false}
    }
    """
    try:
        params = body_to_json(bottle.request)
        logger.info(f'Updating molecular database. ID: {moldb_id}. Params: {params}')
        molecular_db.update(moldb_id, params['archived'])
        return make_response(OK)
    except Exception:
        logger.exception(f'Server error. ID: {moldb_id}. Params: {params}')
        return make_response(INTERNAL_ERROR)
