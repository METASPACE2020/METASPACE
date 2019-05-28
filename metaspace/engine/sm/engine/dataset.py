import json
import logging

from sm.engine.errors import UnknownDSID
from sm.engine.util import SMConfig

logger = logging.getLogger('engine')


class DatasetStatus(object):
    """ Stage of dataset lifecycle """

    """ The dataset is queued for processing """
    QUEUED = 'QUEUED'

    """ The processing is in progress """
    ANNOTATING = 'ANNOTATING'

    """ The processing finished successfully (most common) """
    FINISHED = 'FINISHED'

    """ An error occurred during processing """
    FAILED = 'FAILED'


RESOL_POWER_PARAMS = {
    '70K': {'sigma': 0.00247585727028, 'fwhm': 0.00583019832869, 'pts_per_mz': 2019},
    '100K': {'sigma': 0.0017331000892, 'fwhm': 0.00408113883008, 'pts_per_mz': 2885},
    '140K': {'sigma': 0.00123792863514, 'fwhm': 0.00291509916435, 'pts_per_mz': 4039},
    '200K': {'sigma': 0.000866550044598, 'fwhm': 0.00204056941504, 'pts_per_mz': 5770},
    '250K': {'sigma': 0.000693240035678, 'fwhm': 0.00163245553203, 'pts_per_mz': 7212},
    '280K': {'sigma': 0.00061896431757, 'fwhm': 0.00145754958217, 'pts_per_mz': 8078},
    '500K': {'sigma': 0.000346620017839, 'fwhm': 0.000816227766017, 'pts_per_mz': 14425},
    '750K': {'sigma': 0.000231080011893, 'fwhm': 0.000544151844011, 'pts_per_mz': 21637},
    '1000K': {'sigma': 0.00017331000892, 'fwhm': 0.000408113883008, 'pts_per_mz': 28850},
}

FLAT_DS_CONFIG_KEYS = frozenset({
    'mol_dbs',
    'adducts',
    'ppm',
    'min_px',
    'n_peaks',
    'decoy_sample_size',
    'neutral_losses',
    'chem_mods',
})


class Dataset(object):
    """ Class for representing an IMS dataset
    """
    DS_SEL = ('SELECT id, name, input_path, upload_dt, metadata, config, status, is_public '
              'FROM dataset WHERE id = %s')
    DS_UPD = ('UPDATE dataset set name=%(name)s, input_path=%(input_path)s, upload_dt=%(upload_dt)s, '
              'metadata=%(metadata)s, config=%(config)s, status=%(status)s, is_public=%(is_public)s where id=%(id)s')
    DS_INSERT = ('INSERT INTO dataset (id, name, input_path, upload_dt, metadata, config, status, '
                 'is_public) '
                 'VALUES (%(id)s, %(name)s, %(input_path)s, %(upload_dt)s, %(metadata)s, %(config)s, %(status)s, '
                 '%(is_public)s)')
    # NOTE: config is saved to but never read from the database

    ACQ_GEOMETRY_SEL = 'SELECT acq_geometry FROM dataset WHERE id = %s'
    ACQ_GEOMETRY_UPD = 'UPDATE dataset SET acq_geometry = %s WHERE id = %s'
    IMG_STORAGE_TYPE_SEL = 'SELECT ion_img_storage_type FROM dataset WHERE id = %s'
    IMG_STORAGE_TYPE_UPD = 'UPDATE dataset SET ion_img_storage_type = %s WHERE id = %s'

    def __init__(self, id=None, name=None, input_path=None, upload_dt=None,
                 metadata=None, config=None, status=DatasetStatus.QUEUED,
                 is_public=True, img_storage_type='fs'):
        self.id = id
        self.name = name
        self.input_path = input_path
        self.upload_dt = upload_dt
        self.status = status
        self.is_public = is_public
        self.ion_img_storage_type = img_storage_type

        self.metadata = metadata
        self.config = config
        self._sm_config = SMConfig.get_conf()

    def __str__(self):
        return str(self.__dict__)

    def __eq__(self, other):
        return self.__dict__ == other.__dict__

    def set_status(self, db, es, status):
        self.status = status
        self.save(db, es)

    def notify_update(self, status_queue, action, stage, **kwargs):
        status_queue.publish({
            'ds_id': self.id,
            'status': self.status,
            'action': action,
            'stage': stage,
            **kwargs,
        })

    @classmethod
    def load(cls, db, ds_id):
        docs = db.select_with_fields(cls.DS_SEL, params=(ds_id,))
        if docs:
            return Dataset(**docs[0])
        else:
            raise UnknownDSID('Dataset does not exist: {}'.format(ds_id))

    def is_stored(self, db):
        r = db.select_one(self.DS_SEL, params=(self.id,))
        return True if r else False

    def save(self, db, es=None):
        doc = {
            'id': self.id,
            'name': self.name,
            'input_path': self.input_path,
            'upload_dt': self.upload_dt,
            'metadata': json.dumps(self.metadata or {}),
            'config': json.dumps(self.config or {}),
            'status': self.status,
            'is_public': self.is_public
        }
        if not self.is_stored(db):
            db.insert(self.DS_INSERT, rows=[doc])
        else:
            db.alter(self.DS_UPD, params=doc)
        logger.info("Inserted into dataset table: %s, %s", self.id, self.name)

        if es:
            es.sync_dataset(self.id)

    def get_acq_geometry(self, db):
        r = db.select_one(Dataset.ACQ_GEOMETRY_SEL, params=(self.id,))
        if not r:
            raise UnknownDSID('Dataset does not exist: {}'.format(self.id))
        return r[0]

    def save_acq_geometry(self, db, acq_geometry):
        db.alter(self.ACQ_GEOMETRY_UPD, params=(json.dumps(acq_geometry), self.id))

    def get_ion_img_storage_type(self, db):
        if not self.ion_img_storage_type:
            r = db.select_one(Dataset.IMG_STORAGE_TYPE_SEL, params=(self.id,))
            if not r:
                raise UnknownDSID('Dataset does not exist: {}'.format(self.id))
            self.ion_img_storage_type = r[0]
        return self.ion_img_storage_type

    def save_ion_img_storage_type(self, db, storage_type):
        db.alter(self.IMG_STORAGE_TYPE_UPD, params=(storage_type, self.id))
        self.ion_img_storage_type = storage_type

    def to_queue_message(self):
        msg = {
            'ds_id': self.id,
            'ds_name': self.name,
            'input_path': self.input_path
        }
        email = self.metadata.get('Submitted_By', {}).get('Submitter', {}).get('Email', None)
        if email:
            msg['user_email'] = email.lower()
        return msg


def _get_isotope_generation_from_metadata(metadata):
    assert 'MS_Analysis' in metadata

    sm_config = SMConfig.get_conf()

    polarity = metadata['MS_Analysis']['Polarity']
    polarity_sign = {'Positive': '+', 'Negative': '-'}[polarity]
    instrument = metadata['MS_Analysis']['Analyzer']
    rp = metadata['MS_Analysis']['Detector_Resolving_Power']
    rp_mz = float(rp['mz'])
    rp_resolution = float(rp['Resolving_Power'])

    if instrument == 'FTICR':
        rp200 = rp_resolution * rp_mz / 200.0
    elif instrument == 'Orbitrap':
        rp200 = rp_resolution * (rp_mz / 200.0)**0.5
    else:
        rp200 = rp_resolution

    if rp200 < 85000: params = RESOL_POWER_PARAMS['70K']
    elif rp200 < 120000: params = RESOL_POWER_PARAMS['100K']
    elif rp200 < 195000: params = RESOL_POWER_PARAMS['140K']
    elif rp200 < 265000: params = RESOL_POWER_PARAMS['250K']
    elif rp200 < 390000: params = RESOL_POWER_PARAMS['280K']
    elif rp200 < 625000: params = RESOL_POWER_PARAMS['500K']
    elif rp200 < 875000: params = RESOL_POWER_PARAMS['750K']
    else: params = RESOL_POWER_PARAMS['1000K']

    default_adducts = sm_config['ds_config_defaults']['adducts'][polarity_sign]
    charge = {'Positive': 1, 'Negative': -1}[polarity]
    isocalc_sigma = float(f"{params['sigma']:f}")

    return default_adducts, charge, isocalc_sigma


def generate_ds_config(metadata, mol_dbs=None, adducts=None, ppm=None, min_px=None, n_peaks=None,
                       decoy_sample_size=None, neutral_losses=None, chem_mods=None):
    # The kwarg names should match FLAT_DS_CONFIG_KEYS

    sm_config = SMConfig.get_conf()
    default_moldbs = sm_config['ds_config_defaults']['moldb_names']

    mol_dbs = mol_dbs or []
    mol_dbs = [*mol_dbs, *(mol_db for mol_db in default_moldbs if mol_db not in mol_dbs)]
    default_adducts, charge, isocalc_sigma = _get_isotope_generation_from_metadata(metadata)

    config = {
        'databases': mol_dbs,
        'isotope_generation': {
            'adducts': adducts or default_adducts,
            'charge': charge,
            'isocalc_sigma': isocalc_sigma,
            'n_peaks': n_peaks or 4,
            'neutral_losses': neutral_losses or [],
            'chem_mods': chem_mods or [],
        },
        'fdr': {
            'decoy_sample_size': decoy_sample_size or 20,
        },
        'image_generation': {
            'ppm': ppm or 3,
            'n_levels': 30,
            'min_px': min_px or 1,
        }
    }
    return config


def update_ds_config(old_config, metadata, **kwargs):
    """
    Extracts parameters from an existing ds_config, and uses them to generate a new ds_config with the provided changes.
    See FLAT_DS_CONFIG_KEYS for the list of allowed keys
    """
    assert all(key in FLAT_DS_CONFIG_KEYS for key in kwargs.keys())

    isotope_generation = old_config.get('isotope_generation', {})
    fdr = old_config.get('fdr', {})
    image_generation = old_config.get('image_generation', {})
    old_vals = {
        'mol_dbs': old_config.get('databases'),
        'adducts': isotope_generation.get('adducts'),
        'n_peaks': isotope_generation.get('n_peaks'),
        'neutral_losses': isotope_generation.get('neutral_losses'),
        'chem_mods': isotope_generation.get('chem_mods'),
        'decoy_sample_size': fdr.get('decoy_sample_size'),
        'ppm': image_generation.get('ppm'),
        'min_px': image_generation.get('min_px'),
    }

    for k, v in old_vals.items():
        if v is not None:
            kwargs.setdefault(k, v)

    return generate_ds_config(metadata, **kwargs)