const fileConfig = require('./clientConfig.json');
import {defaultsDeep} from 'lodash-es';
import {getLocalStorage, removeLocalStorage, setLocalStorage} from './lib/localStorage';


interface AWSConfig {
  access_key_id: string;
  region: string;
  s3_bucket: string;
  s3_uuid_endpoint: string;
  s3_signature_endpoint: string;
  s3_signature_version: number;
}

interface FineUploaderConfigS3 {
  storage: 's3';
  aws: AWSConfig;
}

interface FineUploaderConfigLocal {
  storage: 'local';
}

type FineUploaderConfig = FineUploaderConfigS3 | FineUploaderConfigLocal;

interface Features {
  coloc: boolean;
  ion_thumbs: boolean;
  off_sample: boolean;
  off_sample_col: boolean; // Not a "feature" - just shows an extra column for debugging
  new_feature_popups: boolean;
  optical_transform: boolean;
  ignore_pixel_aspect_ratio: boolean;
  all_dbs: boolean;
  all_adducts: boolean;
  neutral_losses: boolean;
  chem_mods: boolean;
  advanced_ds_config: boolean;
}

interface ClientConfig {
  graphqlUrl: string | null;
  wsGraphqlUrl: string | null;
  imageStorage?: string | null;

  google_client_id: string;

  fineUploader: FineUploaderConfig;
  ravenDsn: string | null;
  metadataTypes: string[];
  features: Features;
}

const defaultConfig: ClientConfig = {
  graphqlUrl: null,
  wsGraphqlUrl: null,
  google_client_id: '',
  fineUploader: {
    storage: 'local'
  },
  ravenDsn: null,
  metadataTypes: ["ims"],
  features: {
    coloc: true,
    ion_thumbs: true,
    off_sample: true,
    off_sample_col: false,
    new_feature_popups: true,
    optical_transform: true,
    ignore_pixel_aspect_ratio: false,
    all_dbs: false,
    all_adducts: false,
    neutral_losses: false,
    chem_mods: false,
    advanced_ds_config: false,
  }
};

const FEATURE_STORAGE_KEY = 'featureFlags';

let config = defaultsDeep({}, fileConfig, defaultConfig) as ClientConfig;

export const updateConfigFromQueryString = () => {
  if (typeof window !== 'undefined') {
    // hackily parse the querystring because vue-router hasn't initialized yet and IE doesn't support the
    // URLSearchParams class that can do this properly
    const queryStringFeatures = (window.location.search || '')
      .substring(1)
      .split('&')
      .filter(part => part.startsWith('feat='))
      .map(features => features.substring('feat='.length).split(','))
      .reduce((a, b) => a.concat(b), []);

    const overrides: Partial<Features> = {};
    if (queryStringFeatures.includes('reset')) {
      removeLocalStorage(FEATURE_STORAGE_KEY);
    } else {
      Object.assign(overrides, getLocalStorage(FEATURE_STORAGE_KEY));
    }

    queryStringFeatures.forEach(feat => {
      const val = !feat.startsWith('-');
      const key = (val ? feat : feat.substring(1));
      if (key !== 'reset' && key !== 'save') {
        overrides[key as keyof Features] = val;
      }
    });

    Object.assign(config.features, overrides);

    if (queryStringFeatures.includes('save')) {
      setLocalStorage(FEATURE_STORAGE_KEY, overrides);
    }
  }
};

export const replaceConfigWithDefaultForTests = () => {
  Object.assign(config, defaultConfig);
};

export default config;
