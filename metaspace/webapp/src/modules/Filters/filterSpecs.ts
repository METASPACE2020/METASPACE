import { renderMolFormula } from '../../util';
import InputFilter from './filter-components/InputFilter.vue';
import SingleSelectFilter from './filter-components/SingleSelectFilter.vue';
import SearchableFilter from './filter-components/SearchableFilter.vue';
import OffSampleHelp from './filter-components/OffSampleHelp.vue';
import MzFilter from './filter-components/MzFilter.vue';
import SearchBox from './filter-components/SearchBox.vue';
import {metadataTypes, defaultMetadataType} from '../../lib/metadataRegistry';
import { Component } from 'vue';
import SimpleFilterBox from './filter-components/SimpleFilterBox.vue';
import BooleanFilter from './filter-components/BooleanFilter.vue';
import config from '../../config';

function formatFDR (fdr: number) {
  return fdr ? Math.round(fdr * 100) + '%' : '';
}

export type Level = 'annotation' | 'dataset' | 'upload' | 'projects';

export type FilterKey = 'database' | 'datasetIds' | 'minMSM' | 'compoundName' | 'adduct' | 'mz' | 'fdrLevel'
  | 'group' | 'project' | 'submitter' | 'polarity' | 'organism' | 'organismPart' | 'condition' | 'growthConditions'
  | 'ionisationSource' | 'maldiMatrix' | 'analyzerType' | 'simpleFilter' | 'simpleQuery' | 'metadataType'
  | 'colocalizedWith' | 'colocalizationSamples' | 'offSample';

export type MetadataLists = Record<string, any[]>;

/**
 The specifications below describe the presentation logic of filters.
 Once a filter is added to the specifications list, any pages
 making use of it must also implement the data filtering logic,
 e.g. adding GraphQL query variables and setting them accordingly.

 Data filtering logic is currently located in two places:
 * url.ts
 add new fields to FILTER_TO_URL (for vue-router)
 * store/getters.js
 edit gqlAnnotationFilter and gqlDatasetFilter getters

 You must also add the filter key to filterKeys array in FilterPanel.vue:
 this controls the order of the filters in the dropdown list.

 If options to a select are provided as a string, they are taken from
 FilterPanel computed properties. When a new filter is added that uses
 this feature, fetchOptionListsQuery in api/metadata.js should be tweaked to
 incorporate any extra fields that are needed to populate the options.
 */
export interface FilterSpecification {
  /** Component used for input/display e.g. SingleSelectFilter */
  type: Component;
  /** Name shown on component */
  name: string;
  /** Text used to refer to the filter in the "Add filter" drop-down list */
  description?: string;
  /** Component that contains help text to be displayed as a question mark icon with a popover. Only supported by specific input components */
  helpComponent?: Component;
  /** List of which pages the filter makes sense */
  levels: Level[];
  /** List of which pages the filter should be visible by default */
  defaultInLevels?: Level[];
  /** Initial value of the filter when it is added, or if it is visible by default. Can be a function that is called after MetadataLists is loaded. */
  initialValue: undefined | null | number | string | boolean | ((lists: MetadataLists) => any);
  /** List of options for SingleSelectFilter. Can be a function that is called after MetadataLists is loaded. */
  options?: string | number[] | boolean[] | string[] | ((lists: MetadataLists) => any[]);
  removable?: boolean;
  filterable?: boolean;
  multiple?: boolean;
  hidden?: boolean | (() => boolean);
  /** How to encode/decode this filter from the URL */
  encoding?: 'list' | 'json' | 'bool' | 'number';
  /** Callback to format options for display. "options" parameter may be an empty array while the page is loading */
  optionFormatter?(value: any, options: any[]): string;
  /** Callback to extract the "value" of an object-based option */
  valueGetter?(option: any): any;
  /** Whether an empty string is a valid value or should be considered unset */
  allowEmptyString?: boolean;
  sortOrder?: number;
  /** List of other filters whose removal should cause this filter to also be removed */
  dependsOnFilters?: FilterKey[];
  /** List of other filters whose addition should cause this filter to be removed */
  conflictsWithFilters?: FilterKey[];
}

/** Attrs to pass to the component that will render the filter */
export const FILTER_COMPONENT_PROPS: (keyof FilterSpecification)[] = [
  'name', 'helpComponent',
  'removable', 'filterable', 'multiple',
  'optionFormatter', 'valueGetter', 'allowEmptyString'
];

export const FILTER_SPECIFICATIONS: Record<FilterKey, FilterSpecification> = {
  database: {
    type: SingleSelectFilter,
    name: 'Database',
    description: 'Select database',
    levels: ['annotation'],
    defaultInLevels: ['annotation'],
    initialValue: lists => lists.molecularDatabases
                                .filter(d => d.default)
                                .map(d => d.name)[0],
    options: lists => lists.molecularDatabases
      .filter(d => config.features.all_dbs || !d.hidden)
      .map(d => d.name),
    removable: false
  },

  datasetIds: {
    type: SearchableFilter,
    name: 'Dataset',
    description: 'Select dataset',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,
    multiple: true,
    encoding: 'list'
  },

  minMSM: {
    type: InputFilter,
    name: 'Min. MSM',
    description: 'Set minimum MSM score',
    levels: ['annotation'],
    initialValue: 0.0
  },

  compoundName: {
    type: InputFilter,
    name: 'Molecule',
    description: 'Search molecule',
    levels: ['dataset', 'annotation'],
    initialValue: undefined
  },

  adduct: {
    type: SingleSelectFilter,
    name: 'Adduct',
    description: 'Select adduct',
    levels: ['annotation'],
    initialValue: undefined,
    options: lists => lists.adducts.filter(a => config.features.all_adducts || !a.hidden),
    optionFormatter: adduct => adduct && adduct.name,
    valueGetter: adduct => adduct && adduct.adduct,
    allowEmptyString: true
  },

  mz: {
    type: MzFilter,
    name: 'm/z',
    description: 'Search by m/z',
    levels: ['annotation'],
    initialValue: undefined
  },

  fdrLevel: {
    type: SingleSelectFilter,
    name: 'FDR',
    description: 'Select FDR level',
    levels: ['annotation'],
    defaultInLevels: ['annotation'],
    initialValue: 0.1,

    options: [0.05, 0.1, 0.2, 0.5],
    optionFormatter: formatFDR,
    encoding: 'number',
    filterable: false,
    removable: false
  },

  group: {
    type: SearchableFilter,
    name: 'Group',
    description: 'Select group',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,
  },

  project: {
    type: SearchableFilter,
    name: 'Project',
    description: 'Select project',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,
  },

  submitter: {
    type: SearchableFilter,
    name: 'Submitter',
    description: 'Select submitter',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,
  },

  polarity: {
    type: SingleSelectFilter,
    name: 'Polarity',
    description: 'Select polarity',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    // FIXME: this ideally should be taken straight from the JSON schema
    options: ['Positive', 'Negative'],
    filterable: false
  },

  organism: {
    type: SingleSelectFilter,
    name: 'Organism',
    description: 'Select organism',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    options: 'organisms'
  },

  organismPart: {
    type: SingleSelectFilter,
    name: 'Organism part',
    description: 'Select organism part',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    options: 'organismParts'
  },

  condition: {
    type: SingleSelectFilter,
    name: 'Organism condition',
    description: 'Select organism condition',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    options: 'conditions'
  },

  growthConditions: {
    type: SingleSelectFilter,
    name: 'Sample growth conditions',
    description: 'Select sample growth conditions',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    options: 'growthConditions'
  },

  ionisationSource: {
    type: SingleSelectFilter,
    name: 'Source',
    description: 'Select ionisation source',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    options: 'ionisationSources'
  },

  maldiMatrix: {
    type: SingleSelectFilter,
    name: 'Matrix',
    description: 'Select MALDI matrix',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    options: 'maldiMatrices'
  },

  analyzerType: {
    type: SingleSelectFilter,
    name: 'Analyzer type',
    description: 'Select analyzer',
    levels: ['annotation', 'dataset'],
    initialValue: undefined,

    options: 'analyzerTypes'
  },

  simpleFilter: {
    type: SimpleFilterBox,
    name: 'Simple filter',
    description: 'Quick access to filter presets',
    levels: ['projects'],
    defaultInLevels: ['projects'],
    initialValue: null,
    removable: false,
    sortOrder: 1
  },

  simpleQuery: {
    type: SearchBox,
    name: 'Simple query',
    description: 'Search anything',
    levels: ['annotation', 'dataset', 'projects'],
    defaultInLevels: ['annotation', 'dataset', 'projects'],
    initialValue: '',
    removable: false,
    sortOrder: 2
  },

  metadataType: {
    type: SingleSelectFilter,
    name: 'Data type',
    description: 'Select data type',
    levels: ['annotation', 'dataset', 'upload'],
    defaultInLevels: ['annotation', 'dataset', 'upload'],
    initialValue: defaultMetadataType,
    removable: false,
    options: metadataTypes,
    hidden: () => metadataTypes.length <= 1
  },

  colocalizedWith: {
    type: InputFilter,
    name: 'Colocalized with',
    levels: ['annotation'],
    initialValue: undefined,
    dependsOnFilters: ['fdrLevel', 'database', 'datasetIds'],
    conflictsWithFilters: ['colocalizationSamples'],
  },

  colocalizationSamples: {
    type: BooleanFilter,
    name: 'Representative spatial patterns',
    description: 'Show representative spatial patterns',
    levels: ['annotation'],
    initialValue: true,
    encoding: 'bool',
    dependsOnFilters: ['fdrLevel', 'database', 'datasetIds'],
    conflictsWithFilters: ['colocalizedWith'],
  },

  offSample: {
    type: SingleSelectFilter,
    name: '',
    description: 'Show/hide off-sample annotations',
    helpComponent: OffSampleHelp,
    levels: ['annotation'],
    defaultInLevels: [],
    initialValue: false,
    options: [true, false],
    encoding: 'bool',
    optionFormatter: option => `${option ? 'Off' : 'On'}-sample only`,
    hidden: () => !config.features.off_sample,
  }
};


export const DATASET_FILTERS: FilterKey[] = ['datasetIds', 'group', 'project', 'submitter', 'polarity', 'organism', 'organismPart', 'condition', 'growthConditions', 'ionisationSource', 'maldiMatrix', 'analyzerType', 'metadataType'];
/** = all annotation-affecting filters - dataset-affecting filters*/
export const ANNOTATION_FILTERS: FilterKey[] = ['database', 'minMSM', 'compoundName', 'adduct', 'mz', 'fdrLevel', 'colocalizedWith', 'offSample'];
/** Filters that are very specific to particular annotations and should be cleared when navigating to other annotations */
export const ANNOTATION_SPECIFIC_FILTERS: FilterKey[] = ['compoundName', 'adduct', 'mz', 'colocalizedWith', 'colocalizationSamples'];

export function getFilterInitialValue(key: FilterKey, filterLists?: MetadataLists) {
  let value = FILTER_SPECIFICATIONS[key].initialValue;

  if(typeof value === 'function') {
    if(filterLists != null) {
      value = value(filterLists);
    } else {
      value = null;
    }
  }
  return value;
}

export function getDefaultFilter(level: Level, filterLists?: MetadataLists) {
  const filter: Partial<Record<FilterKey, any>> = {};
  let key: FilterKey;
  for (key in FILTER_SPECIFICATIONS) {
    const spec = FILTER_SPECIFICATIONS[key];
    if (spec.defaultInLevels != null && spec.defaultInLevels.includes(level)) {
      filter[key] = getFilterInitialValue(key, filterLists);
    }
  }
  return filter;
}

