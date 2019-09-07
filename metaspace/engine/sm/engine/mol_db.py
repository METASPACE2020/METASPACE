import pandas as pd
import logging
import requests

from sm.engine.util import SMConfig

logger = logging.getLogger('engine')


class MolDBServiceWrapper:
    def __init__(self, service_url):
        self._service_url = service_url
        self._session = requests.Session()

    def _fetch(self, url):
        r = self._session.get(url)
        r.raise_for_status()
        return r.json()['data']

    def fetch_all_dbs(self):
        url = '{}/databases'.format(self._service_url)
        return self._fetch(url)

    def find_db_by_id(self, id):
        url = '{}/databases/{}'.format(self._service_url, id)
        return self._fetch(url)

    def find_db_by_name_version(self, name, version=None):
        url = '{}/databases?name={}'.format(self._service_url, name)
        if version:
            url += '&version={}'.format(version)
        return self._fetch(url)

    def fetch_db_sfs(self, db_id):
        return self._fetch('{}/databases/{}/sfs'.format(self._service_url, db_id))

    def fetch_molecules(self, db_id, sf=None):
        if sf:
            url = '{}/databases/{}/molecules?sf={}&fields=mol_id,mol_name'
            return self._fetch(url.format(self._service_url, db_id, sf))
        else:
            # TODO: replace one large request with several smaller ones
            url = '{}/databases/{}/molecules?fields=sf,mol_id,mol_name&limit=10000000'
            return self._fetch(url.format(self._service_url, db_id))


class MolecularDB:
    """ A class representing a molecule database to search through.
        Provides several data structures used in the engine to speed up computation
    """

    def __init__(
        self, id=None, name=None, version=None, mol_db_service=None
    ):
        """
        Args
        -----
        id: int
        name: str
        version: str
            If None the latest version will be used
        mol_db_service: sm.engine.MolDBServiceWrapper
            Molecular database ID/name resolver
        """
        sm_config = SMConfig.get_conf()
        self._mol_db_service = mol_db_service or MolDBServiceWrapper(
            sm_config['services']['mol_db']
        )

        if id is not None:
            data = self._mol_db_service.find_db_by_id(id)
        elif name is not None:
            data = self._mol_db_service.find_db_by_name_version(name, version)[0]
        else:
            raise Exception('MolDB id or name should be provided')

        self._id, self._name, self._version = data['id'], data['name'], data['version']

    def __repr__(self):
        return '<{}:{}>'.format(self.name, self.version)

    @property
    def id(self):
        return self._id

    @property
    def name(self):
        return self._name

    @property
    def version(self):
        return self._version

    def get_molecules(self, sf=None):
        """ Returns a dataframe with (mol_id, mol_name) or (sf, mol_id, mol_name) rows

        Args
        -----
        sf: str
        Returns
        -----
            pd.DataFrame
        """
        return pd.DataFrame(self._mol_db_service.fetch_molecules(self.id, sf=sf))

    @property
    def formulas(self):
        """ Total list of formulas """
        return self._mol_db_service.fetch_db_sfs(self.id)
