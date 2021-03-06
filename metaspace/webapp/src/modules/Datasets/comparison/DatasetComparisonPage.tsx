import { Collapse, CollapseItem } from '../../../lib/element-ui'
import {
  computed,
  defineComponent,
  onMounted, reactive,
  ref, watchEffect,
} from '@vue/composition-api'
import { useQuery } from '@vue/apollo-composable'
import { comparisonAnnotationListQuery } from '../../../api/annotation'
import safeJsonParse from '../../../lib/safeJsonParse'
import RelatedMolecules from '../../Annotations/annotation-widgets/RelatedMolecules.vue'
import ImageSaver from '../../ImageViewer/ImageSaver.vue'
import { DatasetComparisonAnnotationTable } from './DatasetComparisonAnnotationTable'
import { DatasetComparisonGrid } from './DatasetComparisonGrid'
import gql from 'graphql-tag'
import FilterPanel from '../../Filters/FilterPanel.vue'
import config from '../../../lib/config'
import { DatasetListItem, datasetListItemsQuery } from '../../../api/dataset'
import MainImageHeader from '../../Annotations/annotation-widgets/default/MainImageHeader.vue'
import Vue from 'vue'

interface GlobalImageSettings {
  resetViewPort: boolean
  scaleBarColor: string
  scaleType: string
  colormap: string
  showOpticalImage: boolean
}

interface DatasetComparisonPageProps {
  className: string
  defaultImagePosition: any
}

interface DatasetComparisonPageState {
  selectedAnnotation: number
  gridState: any
  annotations: any
  datasets: any
  globalImageSettings: GlobalImageSettings
  grid: any
  nCols: number
  nRows: number
  annotationData: any
  refsLoaded: boolean
  showViewer: boolean
  annotationLoading: boolean
  filter: any
  isLoading: any
  collapse: string[]
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
    const imageGrid = ref(null)
    const state = reactive<DatasetComparisonPageState>({
      selectedAnnotation: -1,
      gridState: {},
      globalImageSettings: {
        resetViewPort: false,
        scaleBarColor: '#000000',
        scaleType: 'linear',
        colormap: 'Viridis',
        showOpticalImage: false,
      },
      annotations: [],
      datasets: [],
      collapse: ['images'],
      grid: undefined,
      nCols: 0,
      nRows: 0,
      annotationData: {},
      refsLoaded: false,
      showViewer: false,
      annotationLoading: true,
      filter: $store.getters.filter,
      isLoading: false,
    })
    const { dataset_id: sourceDsId } = $route.params
    const { viewId: snapshotId } = $route.query
    const {
      result: settingsResult,
      loading: settingsLoading,
    } = useQuery<any>(fetchImageViewerSnapshot, {
      id: snapshotId,
      datasetId: sourceDsId,
    })

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

    const queryOptions = reactive({ enabled: false, fetchPolicy: 'no-cache' as const })
    const queryVars = computed(() => ({
      ...queryVariables(),
      dFilter: { ...queryVariables().dFilter, ids: Object.values(state.grid || {}).join('|') },
    }))
    const annotationsQuery = useQuery<any>(comparisonAnnotationListQuery, queryVars, queryOptions)
    const datasetsQuery = useQuery<{allDatasets: DatasetListItem[]}>(datasetListItemsQuery,
      queryVars, queryOptions)
    const loadAnnotations = () => { queryOptions.enabled = true }
    state.annotations = computed(() => {
      if (annotationsQuery.result.value) {
        return annotationsQuery.result.value.allAggregatedAnnotations
      }
      return null
    })
    state.datasets = computed(() => {
      if (datasetsQuery.result.value) {
        return datasetsQuery.result.value.allDatasets
      }
      return null
    })

    const requestAnnotations = async() => {
      state.isLoading = true
      loadAnnotations()
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
    })

    const resetViewPort = (event: any) => {
      if (event) {
        event.stopPropagation()
      }
      state.globalImageSettings.resetViewPort = !state.globalImageSettings.resetViewPort
    }

    const handleScaleBarColorChange = (scaleBarColor: string) => {
      state.globalImageSettings.scaleBarColor = scaleBarColor
    }

    const handleScaleTypeChange = (scaleType: string) => {
      state.globalImageSettings.scaleType = scaleType
    }

    const handleColormapChange = (colormap: string) => {
      state.globalImageSettings.colormap = colormap
    }

    const handleRowChange = (idx: number) => {
      if (idx !== -1) {
        state.isLoading = true
        state.selectedAnnotation = idx
        setTimeout(() => {
          state.isLoading = false
        }, 500)
      }
    }

    const renderImageGallery = (nCols: number, nRows: number) => {
      return (
        <CollapseItem
          id="annot-img-collapse"
          name="images"
          class="ds-collapse el-collapse-item--no-padding relative">
          <MainImageHeader
            class='dataset-comparison-item-header dom-to-image-hidden'
            slot="title"
            isActive={false}
            scaleBarColor={state.globalImageSettings?.scaleBarColor}
            onScaleBarColorChange={handleScaleBarColorChange}
            scaleType={state.globalImageSettings?.scaleType}
            onScaleTypeChange={handleScaleTypeChange}
            colormap={state.globalImageSettings?.colormap}
            onColormapChange={handleColormapChange}
            showOpticalImage={false}
            hasOpticalImage={false}
            resetViewport={resetViewPort}
            toggleOpticalImage={() => {}}
          />
          <ImageSaver
            class="absolute top-0 right-0 mt-2 mr-2 dom-to-image-hidden"
            domNode={gridNode.value}
          />
          <div class='dataset-comparison-grid' ref={gridNode}>
            {
              state.collapse.includes('images')
              && <DatasetComparisonGrid
                ref={imageGrid}
                nCols={nCols}
                nRows={nRows}
                resetViewPort={state.globalImageSettings.resetViewPort}
                onResetViewPort={resetViewPort}
                scaleBarColor={state.globalImageSettings.scaleBarColor}
                scaleType={state.globalImageSettings.scaleType}
                colormap={state.globalImageSettings.colormap}
                settings={gridSettings}
                annotations={state.annotations || []}
                datasets={state.datasets || []}
                selectedAnnotation={state.selectedAnnotation}
                isLoading={state.isLoading || annotationsQuery.loading.value}
              />
            }
          </div>
        </CollapseItem>)
    }

    const renderCompounds = () => {
      // @ts-ignore TS2604
      const relatedMolecules = () => <RelatedMolecules
        query="isomers"
        annotation={state.annotations[state.selectedAnnotation].annotations[0]}
        annotations={state.annotations[state.selectedAnnotation].annotations}
        databaseId={$store.getters.filter.database || 1}
        hideFdr
      />

      return (<CollapseItem
        id="annot-img-collapse"
        name="compounds"
        title="Molecules"
        class="ds-collapse el-collapse-item--no-padding relative">
        {
          !state.isLoading
          && state.collapse.includes('compounds')
          && relatedMolecules()
        }
      </CollapseItem>)
    }

    return () => {
      const nCols = state.nCols
      const nRows = state.nRows

      if (!snapshotId) {
        return (
          <div class='dataset-comparison-page w-full flex flex-wrap flex-row items-center justify-center'>
          Not found
          </div>)
      }
      return (
        <div class='dataset-comparison-page w-full flex flex-wrap flex-row'>
          <FilterPanel class='w-full' level='annotation' hiddenFilters={['datasetIds']}/>
          <div class='dataset-comparison-wrapper w-full md:w-6/12 relative'>
            {
              state.annotations
              && <DatasetComparisonAnnotationTable
                isLoading={state.annotationLoading}
                annotations={state.annotations.map((ion: any) => {
                  return {
                    ...ion.annotations[0],
                    msmScore: Math.max(...ion.annotations.map((annot: any) => annot.msmScore)),
                    fdrlevel: Math.min(...ion.annotations.map((annot: any) => annot.fdrlevel)),
                    datasetCount: (ion.datasetIds || []).length,
                    rawAnnotations: ion.annotations,
                  }
                })}
                onRowChange={handleRowChange}
              />
            }
            {
              (annotationsQuery.loading.value)
              && <div class='w-full absolute text-center top-0'>
                <i
                  class="el-icon-loading"
                />
              </div>
            }
          </div>
          <div class='dataset-comparison-wrapper  w-full  md:w-6/12'>
            <Collapse
              value={state.collapse}
              id="annot-content"
              class="border-0"
              onChange={(activeNames: string[]) => {
                state.collapse = activeNames
              }}>
              {renderImageGallery(nCols, nRows)}
              {renderCompounds()}
            </Collapse>
          </div>
        </div>
      )
    }
  },
})
