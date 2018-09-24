/**
 * Created by intsco on 1/11/17.
 */
const ES_LIMIT_MAX = 50000;

const elasticsearch = require('elasticsearch'),
  sprintf = require('sprintf-js');

const config = require('config'),
  {datasetFilters, dsField} = require('./datasetFilters.js'),
  {logger, canUserViewEsDataset} = require('./utils');

const esConfig = () => {
  return {
    host: [config.elasticsearch],
    apiVersion: '5.0'
  }
};

const esIndex = config.elasticsearch.index;
const es = new elasticsearch.Client(esConfig());

function esFormatMz(mz) {
  // transform m/z into a string according to sm.engine.es_export;
  // add extra 2 digits after decimal place for search queries
  return sprintf.sprintf("%012.6f", mz);
}

function esSort(orderBy, sortingOrder) {
  // default order
  let order = 'asc';
  if (orderBy == 'ORDER_BY_MSM' || orderBy == 'ORDER_BY_DATE')
    order = 'desc';

  if (sortingOrder == 'DESCENDING')
    order = 'desc';
  else if (sortingOrder == 'ASCENDING')
    order = 'asc';

  // annotation orderings
  if (orderBy == 'ORDER_BY_MZ')
    return [{'mz': order}];
  else if (orderBy == 'ORDER_BY_MSM')
    return [{'msm': order}];
  else if (orderBy == 'ORDER_BY_FDR_MSM')
    return [{'fdr': order}, {'msm': order == 'asc' ? 'desc' : 'asc'}];
  else if (orderBy == 'ORDER_BY_DATASET')
    return [{'ds_name': order}, {'mz': order}];
  else if (orderBy == 'ORDER_BY_FORMULA')
    return [{'sf': order}, {'adduct': order}, {'fdr': order}];
  // dataset orderings
  else if (orderBy == 'ORDER_BY_DATE')
    return [{'ds_last_finished': order}];
  else if (orderBy == 'ORDER_BY_NAME')
    return [{'ds_name': order}];
}

function constructESQuery(args, docType, user) {
  const { orderBy, sortingOrder, offset, limit, filter: annotationFilter, datasetFilter, simpleQuery } = args;
  const { database, datasetName, mzFilter, msmScoreFilter,
    fdrLevel, sumFormula, adduct, compoundQuery, annId } = annotationFilter;

  let body = {
    query: {
      bool: {
        filter: []
      }
    }
  };

  if (orderBy)
    body.sort = esSort(orderBy, sortingOrder);

  if (annId)
    addFilter({ term: { _id: annId } });

  if (database) {
    addFilter({term: {db_name: database}});
  }

  function addFilter(filter) {
    body.query.bool.filter.push(filter);
  }

  function addRangeFilter(field, interval) {
    const filter = {range: {}};
    filter.range[field] = {
      gte: interval.min,
      lt: interval.max
    };
    addFilter(filter);
  }

  addFilter({term: {_type: docType}});

  if (mzFilter)
    addRangeFilter('mz', {min: esFormatMz(mzFilter.min),
      max: esFormatMz(mzFilter.max)});

  if (msmScoreFilter)
    addRangeFilter('msm', msmScoreFilter);

  if (fdrLevel)
    addRangeFilter('fdr', {min: 0, max: fdrLevel + 1e-3});

  if (sumFormula)
    addFilter({term: {sf: sumFormula}});

  if (typeof adduct === 'string')
    addFilter({term: {adduct: adduct}});

  if (datasetName)
    addFilter({term: {ds_name: datasetName}});

  if (compoundQuery)
    addFilter({bool: {should: [
      { wildcard: {comp_names: `*${compoundQuery.toLowerCase()}*`}},
      { term: {sf: compoundQuery }}]}});

  if (simpleQuery)
    addFilter({simple_query_string: {
      query: simpleQuery, fields: ["_all"], default_operator: "and"
   }});

  // (!) Visibility filters
  if (!user || !user.id) {
    // not logged in user
    addFilter({ term: { ds_is_public: true } });
  }
  else if (user.role === 'admin') {
    // Admins can see everything - don't filter
  } else if (user.id || user.groupIds) {
    const filterObj = {
      bool: {
        should: [
          { term: { ds_is_public: true } }]
      }
    };
    if (user.id) {
      filterObj.bool.should.push({ term: { ds_submitter_id: user.id } });
    }
    if (user.groupIds) {
      filterObj.bool.should.push({ terms: { ds_group_id: user.groupIds } });
    }
    addFilter(filterObj);
  }

  if (datasetFilter) {
    for (let key of Object.keys(datasetFilter)) {
      const val = datasetFilter[key];
      if (val) {
        const f = datasetFilters[key].esFilter(val);
        addFilter(f);
      }
    }
  }
  return body;
}

const esSearchResults = async function(args, docType, user) {
  if (args.limit > ES_LIMIT_MAX) {
    return Error(`The maximum value for limit is ${ES_LIMIT_MAX}`)
  }

  const body = constructESQuery(args, docType, user);
  const request = {
    body,
    index: esIndex,
    from: args.offset,
    size: args.limit
  };
  // console.time('esQuery');

  const resp = await es.search(request);
  return resp.hits.hits;
};

module.exports.esSearchResults = esSearchResults;

module.exports.esCountResults = async function(args, docType, user) {
  const body = constructESQuery(args, docType, user);
  const request = { body, index: esIndex };
  const resp = await es.count(request);
  return resp.count;
};

const fieldEnumToSchemaPath = {
  DF_INSTITUTION: datasetFilters.institution.esField,
  DF_SUBMITTER_NAME: {
    script: {
      // NOTE: In elasticsearch 6, "inline" is replaced with "source"
      inline: `doc['${datasetFilters.submitter.esField}.First_Name'].value + ' ' + doc['${datasetFilters.submitter.esField}.Surname'].value`,
      lang: "painless",
    }
  },
  DF_POLARITY: datasetFilters.polarity.esField,
  DF_ION_SOURCE: datasetFilters.ionisationSource.esField,
  DF_ANALYZER_TYPE: datasetFilters.analyzerType.esField,
  DF_ORGANISM: datasetFilters.organism.esField,
  DF_ORGANISM_PART: datasetFilters.organismPart.esField,
  DF_CONDITION: datasetFilters.condition.esField,
  DF_GROWTH_CONDITIONS: datasetFilters.growthConditions.esField,
  DF_MALDI_MATRIX: datasetFilters.maldiMatrix.esField
};

function addTermAggregations(requestBody, fields) {
  const esFields = fields.map(f => fieldEnumToSchemaPath[f]);
  let aggregations = null;
  for (let i = fields.length - 1; i >= 0; --i) {
    const f = fields[i], ef = esFields[i];
    // TODO introduce max number of groups and use sum_other_doc_count?
    const terms = typeof ef === 'string' ? { field: ef, size: 1000 } : ef;
    let tmp = { aggs: { [f]: { terms } } };

    if (aggregations)
      tmp.aggs[f] = Object.assign(aggregations, tmp.aggs[f]);
    aggregations = tmp;
  }
  requestBody = Object.assign(aggregations, requestBody);
  return requestBody;
}

function flattenAggResponse(fields, aggs, idx) {
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

module.exports.esCountGroupedResults = function(args, docType, user) {
  const q = constructESQuery(args, docType, user);

  if (args.groupingFields.length == 0) {
    // handle case of no grouping for convenience
    logger.info(q);
    const request = { body: q, index: esIndex };
    return es.count(request).then((resp) => {
      return {counts: [{fieldValues: [], count: resp.count}]};
    }).catch((e) => {
      logger.error(e);
      return e.message;
    });
  }

  const body = addTermAggregations(q, args.groupingFields);
  logger.info(body);
  const request = { body, index: esIndex, size: 0 };
  console.time('esAgg');
  return es.search(request)
    .then(resp => {
      console.timeEnd('esAgg');
      return flattenAggResponse(args.groupingFields, resp.aggregations, 0);
    })
    .catch((e) => {
      logger.error(e);
      return e.message;
    });
}

async function getById(args, docType, user) {
  const docs = await esSearchResults(args, docType, user);
  return docs ? docs[0] : null;
}

module.exports.esAnnotationByID = async function(id, user) {
  return getById({ filter: { annId: id } }, 'annotation', user);
};

module.exports.esDatasetByID = async function(id, user) {
  return getById({
    filter: {},
    datasetFilter: { ids: id }
  }, 'dataset', user);
};
