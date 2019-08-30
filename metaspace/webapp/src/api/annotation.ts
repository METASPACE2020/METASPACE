import gql from 'graphql-tag';

export const annotationListQuery =
gql`query GetAnnotations($orderBy: AnnotationOrderBy, $sortingOrder: SortingOrder,
                           $offset: Int, $limit: Int, $query: String,
                           $filter: AnnotationFilter, $dFilter: DatasetFilter,
                           $colocalizationCoeffFilter: ColocalizationCoeffFilter,
                           $countIsomerCompounds: Boolean) {
    allAnnotations(filter: $filter, datasetFilter: $dFilter, simpleQuery: $query,
      orderBy: $orderBy, sortingOrder: $sortingOrder,
      offset: $offset, limit: $limit) {
        id
        sumFormula
        adduct
        ion
        ionFormula
        database
        msmScore
        rhoSpatial
        rhoSpectral
        rhoChaos
        fdrLevel
        mz
        colocalizationCoeff(colocalizationCoeffFilter: $colocalizationCoeffFilter)
        offSample
        offSampleProb
        dataset {
          id
          submitter { id name email }
          principalInvestigator { name email }
          group { id name shortName }
          groupApproved
          projects { id name }
          name
          polarity
          metadataJson
          isPublic
        }
        isotopeImages {
          mz
          url
          minIntensity
          maxIntensity
          totalIntensity
        }
        isomers {
          ion
        }
        countPossibleCompounds(includeIsomers: $countIsomerCompounds)
        possibleCompounds {
          name
          imageURL
          information {
            database
            url
          }
        }
      }

    countAnnotations(filter: $filter, datasetFilter: $dFilter, simpleQuery: $query)
  }`;

export const tableExportQuery =
gql`query Export($orderBy: AnnotationOrderBy, $sortingOrder: SortingOrder,
                   $offset: Int, $limit: Int, $query: String,
                   $filter: AnnotationFilter, $dFilter: DatasetFilter,
                   $colocalizationCoeffFilter: ColocalizationCoeffFilter) {
    annotations: allAnnotations(filter: $filter, datasetFilter: $dFilter,
                                simpleQuery: $query,
                                orderBy: $orderBy, sortingOrder: $sortingOrder,
                                offset: $offset, limit: $limit) {
      id
      sumFormula
      adduct
      ion
      mz
      msmScore
      fdrLevel
      rhoSpatial
      rhoSpectral
      rhoChaos
      offSample
      offSampleProb
      dataset {
        id
        name
        group { id name }
        groupApproved
      }
      possibleCompounds {
        name
        information {
          databaseId
        }
      }
      colocalizationCoeff(colocalizationCoeffFilter: $colocalizationCoeffFilter)
    }
  }`;

export const annotationQuery =
gql`query GetAnnotation($id: String!) {
    annotation(id: $id) {
      id
      peakChartData
      isotopeImages {
        mz
        totalIntensity
      }
    }
  }`;

export const relatedAnnotationsQuery =
gql`query GetRelatedAnnotations($datasetId: String!, $filter: AnnotationFilter!, 
                                $orderBy: AnnotationOrderBy, $sortingOrder: SortingOrder,
                                $colocalizationCoeffFilter: ColocalizationCoeffFilter) {
    allAnnotations(datasetFilter: {
      ids: $datasetId
    }, filter: $filter, limit: 12, orderBy: $orderBy, sortingOrder: $sortingOrder) {
      id
      mz
      sumFormula
      adduct
      ion
      msmScore
      rhoSpatial
      rhoSpectral
      rhoChaos
      fdrLevel
      isotopeImages {
        url
        minIntensity
        maxIntensity
      }
      possibleCompounds {
        name
      }
      colocalizationCoeff(colocalizationCoeffFilter: $colocalizationCoeffFilter)
    }
  }`;

export const relatedMoleculesQuery =
  gql`query RelatedMoleculesQuery($datasetId: String!, $filter: AnnotationFilter!, 
                                $orderBy: AnnotationOrderBy, $sortingOrder: SortingOrder) {
    allAnnotations(datasetFilter: {
      ids: $datasetId
    }, filter: $filter, limit: 12, orderBy: $orderBy, sortingOrder: $sortingOrder) {
      id
      mz
      sumFormula
      adduct
      ion
      fdrLevel
      possibleCompounds {
        name
        imageURL
        information {
          database
          url
        }
      }
    }
  }`;
