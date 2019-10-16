import {
  AnnotationFilter,
  AnnotationOrderBy,
  DatasetFilter,
  DatasetOrderBy, Query,
  SortingOrder,
} from '../../../binding';
import {ESAnnotation} from '../../../../esConnector';

// A superset of allAnnotations, countAnnotations, allDatasets and countDatasets
export interface QueryFilterArgs {
  orderBy?: AnnotationOrderBy | DatasetOrderBy;
  sortingOrder?: SortingOrder;
  offset?: number;
  limit?: number;
  filter?: AnnotationFilter;
  datasetFilter?: DatasetFilter;
  simpleQuery?: string;
}

export type PostProcessFunc = (annotations: ESAnnotation[]) => ESAnnotation[];

export interface QueryFilterResult {
  args: QueryFilterArgs;
  postprocess?: PostProcessFunc;
}

export interface ESAnnotationWithColoc extends ESAnnotation {
  _cachedColocCoeff: number | null;
  _isColocReference: boolean;

  getColocalizationCoeff(_colocalizedWith: string, _colocalizationAlgo: string,
                         _database: string, _fdrLevel: number): Promise<number | null>;
}
