/**
 * Created by intsco on 1/11/17.
 */
import {UserProjectRoleOptions as UPRO} from './src/modules/project/model';
import * as elasticsearch from 'elasticsearch';
import * as sprintf from 'sprintf-js';
import config from './src/utils/config';
import logger from './src/utils/logger';
import {datasetFilters} from './datasetFilters';
import {ContextUser, UserProjectRoles} from './src/context';
import {AnnotationFilter, AnnotationOrderBy, DatasetFilter, DatasetOrderBy, SortingOrder} from './src/binding';
import * as _ from 'lodash';

const ES_LIMIT_MAX = 50000;

type DocType = 'dataset' | 'annotation';

export interface ESDataset {
  _source: ESDatasetSource;
}

export interface ESAnnotation {
  _id: string;
  _source: ESAnnotationSource;
}

export type ImageStorageType = 'fs' | 'db';

export interface ESDatasetSource {
  ds_id: string;
  ds_name: string;
  ds_upload_dt: string;
  ds_config: any;
  ds_meta: any;
  ds_status: string;
  ds_status_update_dt: string;
  ds_input_path: string;
  ds_ion_img_storage: ImageStorageType;
  ds_is_public: boolean;
  ds_mol_dbs: string[];
  ds_adducts: string[];
  ds_neutral_losses: string[];
  ds_chem_mods: string[];
  ds_acq_geometry: any;
  ds_submitter_id: string;
  ds_submitter_name: string;
  ds_submitter_email: string;
  ds_group_id: string | null;
  ds_group_name: string | null;
  ds_group_short_name: string | null;
  ds_group_approved: boolean;
  ds_project_ids?: string[];
  annotation_counts: any[];
}

export interface Isobar {
  ion: string;
  ion_formula: string;
  msm: number;
  peak_ns: number[];
}

export interface ESAnnotationSource extends ESDatasetSource {
  job_id: number;
  db_name: string;
  db_version: any;

  formula: string;
  adduct: string;
  neutral_loss: string;
  chem_mod: string;
  ion: string;
  ion_formula: string;
  polarity: '-'|'+';

  mz: number;
  centroid_mzs: number[];
  iso_image_ids: (string|null)[];
  total_iso_ints: number[];
  min_iso_ints: number[];
  max_iso_ints: number[];

  chaos: number;
  image_corr: number;
  pattern_match: number;
  fdr: number;
  msm: number;
  comp_ids: string[];
  comp_names: string[];
  comps_count_with_isomers?: number;
  isomer_ions: string[];
  isobars?: Isobar[];

  off_sample_prob?: number;
  off_sample_label?: 'on' | 'off';
}

const esConfig = () => {
  return {
    host: [config.elasticsearch],
    apiVersion: '5.0'
  }
};

const esIndex = config.elasticsearch.index;
const es = new elasticsearch.Client(esConfig());

function esFormatMz(mz: number) {
  // transform m/z into a string according to sm.engine.es_export;
  // add extra 2 digits after decimal place for search queries
  return sprintf.sprintf("%012.6f", mz);
}

function esSort(orderBy: AnnotationOrderBy | DatasetOrderBy, sortingOrder: SortingOrder | null) {
  // default order
  let order: 'asc' | 'desc' = 'asc';
  if (orderBy === 'ORDER_BY_MSM' || orderBy === 'ORDER_BY_DATE')
    order = 'desc';

  if (sortingOrder === 'DESCENDING')
    order = 'desc';
  else if (sortingOrder === 'ASCENDING')
    order = 'asc';

  const sortTerm = (field: string, order: 'asc' | 'desc') => {
    const obj: any = {};
    // unmapped_type to avoid exceptions in ES when where is nothing to sort
    obj[field] = { order: order, unmapped_type: 'string' };
    return obj;
  };

  // annotation orderings
  if (orderBy === 'ORDER_BY_MZ')
    return [sortTerm('mz', order)];
    // return sortTerms([{ mz: order }]);
  else if (orderBy === 'ORDER_BY_MSM')
    return [sortTerm('msm', order)];
  else if (orderBy === 'ORDER_BY_FDR_MSM')
    return [sortTerm('fdr', order), sortTerm('msm', order === 'asc' ? 'desc' : 'asc')];
  else if (orderBy === 'ORDER_BY_DATASET')
    return [sortTerm('ds_name', order), sortTerm('mz', order)];
  else if (orderBy === 'ORDER_BY_FORMULA')
    return [sortTerm('formula', order), sortTerm('adduct', order), sortTerm('fdr', order)];
  else if (orderBy === 'ORDER_BY_OFF_SAMPLE')
    return [sortTerm('off_sample_prob', order)];
  // dataset orderings
  else if (orderBy === 'ORDER_BY_DATE')
    return [
      sortTerm('ds_status_update_dt', order),
      sortTerm('ds_last_finished', order),
    ];
  else if (orderBy === 'ORDER_BY_NAME')
    return [sortTerm('ds_name', order)];
}

function constructRangeFilter(field: keyof ESAnnotationSource, interval: {min: number|string, max: number|string}) {
  return {
    range: {
      [field]: {
        gte: interval.min,
        lt: interval.max,
      },
    },
  };
}

function constructTermOrTermsFilter(field: keyof ESAnnotationSource, valueOrValues: any) {
  if (Array.isArray(valueOrValues)) {
    return { terms: { [field]: valueOrValues } };
  } else {
    return { term: { [field]: valueOrValues } };
  }
}

const constructAuthFilters = (user: ContextUser, userProjectRoles: UserProjectRoles) => {
  // (!) Authorisation checks
  if (user.id != null && user.role === 'admin') {
    // Admins can see everything - don't filter
    return [];
  } else {
    // Public datasets
    const should: any[] = [
      {term: {ds_is_public: true}},
    ];
    // User is owner
    if (user.id) {
      should.push({ term: { ds_submitter_id: user.id } } );
    }
    // User's group
    if (user.groupIds) {
      should.push({
        bool: {
          filter: [
            { terms: { ds_group_id: user.groupIds } },
            { term: { ds_group_approved: true } },
          ]
        }
      });
    }
    // Projects user has access to
    const visibleProjectIds = Object.entries(userProjectRoles || [])
      .filter(([id, role]) => ([UPRO.MEMBER, UPRO.MANAGER, UPRO.REVIEWER] as any[]).includes(role))
      .map(([id, role]) => id);
    if (visibleProjectIds.length > 0) {
      should.push({terms: {ds_project_ids: visibleProjectIds}});
    }
    return [{ bool: { should } }];
  }
};

function constructDatasetFilters(filter: DatasetFilter) {
  const filters = [];
  for (let [key, val] of (Object.entries(filter) as [keyof DatasetFilter, any][])) {
    if (val) {
      const datasetFilter = datasetFilters[key];
      if (datasetFilter != null) {
        filters.push(datasetFilter.esFilter(val));
      } else if (datasetFilter === undefined) {
        console.error(`Missing datasetFilter[${key}]`);
      }
    }
  }
  return filters;
}
interface ExtraAnnotationFilters {
  annId?: string;
}
function constructAnnotationFilters(filter: AnnotationFilter & ExtraAnnotationFilters) {
  const {
    database, datasetName, mzFilter, msmScoreFilter, fdrLevel,
    sumFormula, chemMod, neutralLoss, adduct, ion, ionFormula, offSample, compoundQuery, annId,
    isobaricWith, hasNeutralLoss, hasChemMod, hasHiddenAdduct
  } = filter;
  const filters = [];

  if (mzFilter)
    filters.push(constructRangeFilter('mz', {
      min: esFormatMz(mzFilter.min),
      max: esFormatMz(mzFilter.max)
    }));

  if (msmScoreFilter)
    filters.push(constructRangeFilter('msm', msmScoreFilter));

  if (fdrLevel)
    filters.push(constructRangeFilter('fdr', {min: 0, max: fdrLevel + 1e-3}));

  if (annId)
    filters.push({term: { _id: annId }});
  if (database)
    filters.push({term: {db_name: database}});
  if (sumFormula)
    filters.push({term: {formula: sumFormula}});
  if (chemMod != null)
    filters.push({term: {chem_mod: chemMod}});
  if (neutralLoss != null)
    filters.push({term: {neutral_loss: neutralLoss}});
  if (adduct != null)
    filters.push({term: {adduct: adduct}});
  if (datasetName)
    filters.push({term: {ds_name: datasetName}});
  if (offSample != null)
    filters.push({term: {off_sample_label: offSample ? 'off' : 'on'}});
  if (hasNeutralLoss === false) {
    filters.push({term: {neutral_loss: ''}});
  }
  if (hasChemMod === false) {
    filters.push({term: {chem_mod: ''}});
  }
  if (hasHiddenAdduct === false) {
    filters.push({bool: {must_not: [{terms: {adduct: config.adducts.filter(a => a.hidden).map(a => a.adduct)}}]}})
  }
  if (ion != null) {
    filters.push(constructTermOrTermsFilter('ion', ion));
  }
  if (ionFormula != null) {
    filters.push(constructTermOrTermsFilter('ion_formula', ionFormula));
  }
  if (isobaricWith != null) {
    filters.push(constructTermOrTermsFilter('isobars.ion_formula' as any, isobaricWith))
  }

  if (compoundQuery) {
    filters.push({
      bool: {
        should: [
          { wildcard: { comp_names: `*${compoundQuery.toLowerCase()}*` } },
          { term: { formula: compoundQuery } }]
      }
    });
  }

  return filters;
}

function constructSimpleQueryFilter(simpleQuery: string) {
  return {
    simple_query_string: {
      query: simpleQuery,
      fields: ["_all", "ds_name.searchable"],
      default_operator: "and"
    }
  };
}

function constructESQuery(args: any, docType: DocType, user: ContextUser,
                          userProjectRoles: UserProjectRoles, bypassAuth = false) {
  const { orderBy, sortingOrder, filter, datasetFilter, simpleQuery } = args;

  return {
    query: {
      bool: {
        filter: [
          {term: {_type: docType}},
          ...(bypassAuth ? [] : constructAuthFilters(user, userProjectRoles)),
          ...constructDatasetFilters(datasetFilter || {}),
          ...constructAnnotationFilters(filter || {}),
          ...(simpleQuery ? [constructSimpleQueryFilter(simpleQuery)] : []),
        ]
      }
    },
    ...(orderBy ? {sort: esSort(orderBy, sortingOrder)} : {}),
  };
}

export const esSearchResults = async (args: any, docType: DocType,
                                      user: ContextUser, bypassAuth?: boolean): Promise<any[]> => {
  if (args.limit > ES_LIMIT_MAX) {
    throw Error(`The maximum value for limit is ${ES_LIMIT_MAX}`)
  }

  const body = constructESQuery(args, docType, user, await user.getProjectRoles(), bypassAuth);
  const request = {
    body,
    index: esIndex,
    from: args.offset,
    size: args.limit
  };

  const resp = await es.search(request);
  return resp.hits.hits;
};


export const esCountResults = async (args: any, docType: DocType, user: ContextUser): Promise<number> => {
  const body = constructESQuery(args, docType, user, await user.getProjectRoles());
  const request = { body, index: esIndex };
  const resp = await es.count(request);
  return resp.count;
};

const fieldEnumToSchemaPath = {
  DF_GROUP: 'ds_group_short_name',
  DF_SUBMITTER_NAME: 'ds_submitter_name',
  DF_POLARITY: datasetFilters.polarity.esField,
  DF_ION_SOURCE: datasetFilters.ionisationSource.esField,
  DF_ANALYZER_TYPE: datasetFilters.analyzerType.esField,
  DF_ORGANISM: datasetFilters.organism.esField,
  DF_ORGANISM_PART: datasetFilters.organismPart.esField,
  DF_CONDITION: datasetFilters.condition.esField,
  DF_GROWTH_CONDITIONS: datasetFilters.growthConditions.esField,
  DF_MALDI_MATRIX: datasetFilters.maldiMatrix.esField,
  DF_STATUS: 'ds_status',
};

function constructTermAggregations(fields: (keyof typeof fieldEnumToSchemaPath)[]) {
  const esFields = fields.map(f => fieldEnumToSchemaPath[f]);
  let aggs = undefined;
  for (let i = fields.length - 1; i >= 0; --i) {
    const f = fields[i], ef = esFields[i];
    // TODO introduce max number of groups and use sum_other_doc_count?
    const terms = typeof ef === 'string' ? { field: ef, size: 1000 } : ef;
    aggs = { [f]: { terms, aggs } };
  }
  return aggs;
}

function flattenAggResponse(fields: string[], aggs: any, idx: number): any {
  const {buckets} = aggs[fields[idx]];
  let counts = [];
  for (let bucket of buckets) {
    const {key, doc_count} = bucket;

    // handle base case
    if (idx + 1 == fields.length) {
      counts.push({fieldValues: [key], count: doc_count});
      continue;
    }

    const nextField = fields[idx + 1],
          subAggs = {[nextField]: bucket[nextField]},
          nextCounts = flattenAggResponse(fields, subAggs, idx + 1).counts;

    for (let {fieldValues, count} of nextCounts)
      counts.push({fieldValues: [key].concat(fieldValues), count});
  }

  return { counts };
}

export const esCountGroupedResults = async (args: any, docType: DocType, user: ContextUser): Promise<any> => {
  const body = constructESQuery(args, docType, user, await user.getProjectRoles());

  if (args.groupingFields.length === 0) {
    // handle case of no grouping for convenience
    const request = { body, index: esIndex };
    const resp = await es.count(request);
    return {counts: [{fieldValues: [], count: resp.count}]};
  }

  const aggRequest = {
    body: {
      ...body,
      aggs: constructTermAggregations(args.groupingFields)
    },
    index: esIndex,
    size: 0,
  };
  const resp = await es.search(aggRequest);
  return flattenAggResponse(args.groupingFields, resp.aggregations, 0);
};

export const esCountMatchingAnnotationsPerDataset = async (args: any, user: ContextUser): Promise<Record<string, number>> => {
  const body = constructESQuery(args, 'annotation', user, await user.getProjectRoles());
  const aggRequest = {
    body: {
      ...body,
      aggs: { ds_id: { terms: { field: 'ds_id', size: 1000000 } } },
    },
    index: esIndex,
    size: 0,
  };
  const resp = await es.search(aggRequest);
  const counts = resp.aggregations.ds_id.buckets.map(({ key, doc_count }: any) => [key, doc_count]);
  return _.fromPairs(counts);
};

export interface FilterValueCountArgs {
  filters: any[];
  aggsTerms: any;
  user: ContextUser;
  docType?: DocType;
}

export const esFilterValueCountResults = async (args: FilterValueCountArgs): Promise<any> => {
  const {filters, aggsTerms, user, docType = 'dataset'} = args;
  const body = {
    query: {
      bool: {
        filter: [
          ...constructAuthFilters(user, await user.getProjectRoles()),
          { term: { _type: docType } },
          ...filters,
        ]
      }
    },
    size: 0,  // return only aggregations
    aggs: { field_counts: aggsTerms }
  };

  const resp = await es.search({
    body,
    index: esIndex
  });
  const itemCounts: any = {};
  resp.aggregations.field_counts.buckets.forEach((o: any) => {
    itemCounts[o.key] = o.doc_count;
  });
  return itemCounts;
};

async function getFirst(args: any, docType: DocType, user: ContextUser, bypassAuth: boolean = false) {
  const docs = await esSearchResults(args, docType, user, bypassAuth);
  return docs && docs[0] && docs[0]._source ? docs[0] : null;
}

export const esAnnotationByID = async (id: string, user: ContextUser): Promise<ESAnnotationSource | null> => {
  if (id)
    return getFirst({ filter: { annId: id } }, 'annotation', user);
  return null;
};

export const esDatasetByID = async (id: string, user: ContextUser,
                                    bypassAuth?: boolean): Promise<ESDataset | null> => {
  if (id)
    return getFirst({ datasetFilter: { ids: id } }, 'dataset', user, bypassAuth);
  return null;
};

