import { Collapse, CollapseItem } from '../../../lib/element-ui'
import {
  computed,
  defineComponent,
  onMounted, reactive,
  ref, watchEffect,
} from '@vue/composition-api'
import { useQuery, useMutation } from '@vue/apollo-composable'
import { comparisonAnnotationListQuery } from '../../../api/annotation'
import safeJsonParse from '../../../lib/safeJsonParse'
import RelatedMolecules from '../../Annotations/annotation-widgets/RelatedMolecules.vue'
import ImageSaver from '../../ImageViewer/ImageSaver.vue'
import { DatasetComparisonAnnotationTable } from './DatasetComparisonAnnotationTable'
import { DatasetComparisonGrid } from './DatasetComparisonGrid'
import gql from 'graphql-tag'
import FilterPanel from '../../Filters/FilterPanel.vue'
import { isEqual } from 'lodash'
import config from '../../../lib/config'

interface DatasetComparisonPageProps {
  className: string
  defaultImagePosition: any
}

export default defineComponent<DatasetComparisonPageProps>({
  name: 'DatasetComparisonPage',
  props: {
    className: {
      type: String,
      default: 'dataset-comparison',
    },
    defaultImagePosition: {
      type: Object,
      default: () => ({
        zoom: 1,
        xOffset: 0,
        yOffset: 0,
      }),
    },
  },

  // @ts-ignore
  setup(props, { refs, root }) {
    const fetchImageViewerSnapshot = gql`query fetchImageViewerSnapshot($id: String!, $datasetId: String!) {
      imageViewerSnapshot(id: $id, datasetId: $datasetId) {
        snapshot
      }
    }`
    const { $route, $store } = root
    const gridNode = ref(null)
    const state = reactive<any>({
      selectedAnnotation: 0,
      gridState: {},
      annotations: [],
      grid: undefined,
      nCols: 0,
      nRows: 0,
      annotationData: {},
      refsLoaded: false,
      showViewer: false,
      annotationLoading: true,
      filter: $store?.getters?.filter,
      isLoading: false,
    })
    const { snapshot_id: snapshotId, dataset_id: sourceDsId } = $route.params
    const {
      result: settingsResult,
      loading: settingsLoading,
    } = useQuery<any>(fetchImageViewerSnapshot, {
      id: snapshotId,
      datasetId: sourceDsId,
    })
    const { mutate: annotationsMutation } = useMutation<any>(comparisonAnnotationListQuery)

    const gridSettings = computed(() => settingsResult.value != null
      ? settingsResult.value.imageViewerSnapshot : null)

    const queryVariables = () => {
      const filter = $store.getters.gqlAnnotationFilter
      const dFilter = $store.getters.gqlDatasetFilter
      const colocalizationCoeffFilter = $store.getters.gqlColocalizationFilter
      const query = $store.getters.ftsQuery

      return {
        filter,
        dFilter,
        query,
        colocalizationCoeffFilter,
        countIsomerCompounds: config.features.isomers,
      }
    }

    const requestAnnotations = async() => {
      state.isLoading = true
      const query : any = queryVariables()
      query.dFilter.ids = Object.values(state.grid).join('|')

      // although a querying is been done, given we want to get the annotation data
      // on demand, and we have a limitation using refetch or query options enabled for use Query
      // on this case we are querying using the useMutate
      const result = await annotationsMutation(query)

      state.annotations = result.data.allAggregatedAnnotations
      state.annotationLoading = false
      state.isLoading = false
    }

    onMounted(() => {
      state.refsLoaded = true
    })

    watchEffect(async() => {
      if (!state.grid && gridSettings.value) {
        const auxSettings = safeJsonParse(gridSettings.value.snapshot)
        state.nCols = auxSettings.nCols
        state.nRows = auxSettings.nRows
        state.grid = auxSettings.grid
        await requestAnnotations()
      }
      if (!isEqual(state.filter, $store.getters.filter) && state.grid) { // requery onFilter update
        state.filter = $store.getters.filter
        await requestAnnotations()
      }
    })

    const handleRowChange = (idx: number) => {
      if (idx !== -1) {
        state.selectedAnnotation = idx
      }
    }

    const renderImageGallery = (nCols: number, nRows: number) => {
      return (
        <CollapseItem
          id="annot-img-collapse"
          name="images"
          title="Image viewer"
          class="ds-collapse el-collapse-item--no-padding relative">
          <ImageSaver
            class="absolute top-0 right-0 mt-2 mr-2 dom-to-image-hidden"
            domNode={gridNode.value}
          />
          <div class='dataset-comparison-grid' ref={gridNode}>
            <DatasetComparisonGrid
              nCols={nCols}
              nRows={nRows}
              settings={gridSettings}
              annotations={state.annotations}
              selectedAnnotation={state.selectedAnnotation}
              isLoading={state.isLoading}
            />
          </div>
        </CollapseItem>)
    }

    const renderCompounds = () => {
      // @ts-ignore TS2604
      const relatedMolecules = (annotation: any) => <RelatedMolecules
        query="isomers"
        annotation={annotation}
        databaseId={$store.getters.filter.database || 1}
        hideFdr
      />

      return (<CollapseItem
        id="annot-img-collapse"
        name="compounds"
        title="Molecules"
        class="ds-collapse el-collapse-item--no-padding relative">
        {
          state.annotations[state.selectedAnnotation]
          && state.annotations[state.selectedAnnotation].datasets.map((ds: any) => {
            return relatedMolecules(ds)
          })
        }
      </CollapseItem>)
    }

    return () => {
      const nCols = state.nCols
      const nRows = state.nRows

      return (
        <div class='dataset-comparison-page w-full flex flex-wrap flex-row'>
          <FilterPanel class='w-full' level='annotation'/>
          <div class='dataset-comparison-wrapper w-full md:w-4/12'>
            <DatasetComparisonAnnotationTable
              isLoading={state.annotationLoading}
              annotations={(state.annotations || []).map((ion: any) => ion.datasets[0])}
              onRowChange={handleRowChange}/>
          </div>
          <div class='dataset-comparison-wrapper  w-full  md:w-8/12'>
            <Collapse value={'images'} id="annot-content"
              class="border-0">
              {renderImageGallery(nCols, nRows)}
              {renderCompounds()}
            </Collapse>
          </div>
        </div>
      )
    }
  },
})
