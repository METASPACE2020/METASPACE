import FilterLink from './FilterLink'
import { computed, defineComponent, reactive } from '@vue/composition-api'
import { DatasetDetailItem, deleteDatasetQuery, reprocessDatasetQuery } from '../../../api/dataset'
import DatasetInfo from '../../../components/DatasetInfo.vue'
import DownloadDialog from './DownloadDialog'
import reportError from '../../../lib/reportError'
import { formatDatabaseLabel } from '../../MolecularDatabases/formatting'
import config from '../../../lib/config'

const DatasetItemActions = defineComponent({
  name: 'DatasetItemActions',
  props: {
    showOverview: { type: Boolean, default: true },
    dataset: { type: Object as () => DatasetDetailItem, required: true },
    metadata: { type: Object as () => any, required: true },
    currentUser: { type: Object as () => any },
  },
  setup(props, { emit, root: { $apollo, $confirm, $notify } }) {
    const state = reactive({
      disabled: false,
      showMetadataDialog: false,
      showDownloadDialog: false,
    })

    const openDeleteDialog = async(e: Event) => {
      e.preventDefault()
      const force = props.currentUser != null
        && props.currentUser.role === 'admin'
        && props.dataset.status !== 'FINISHED'
      try {
        const msg = `Are you sure you want to ${force ? 'FORCE-DELETE' : 'delete'} ${props.dataset.name}?`
        await $confirm(msg, {
          type: force ? 'warning' : undefined,
          lockScroll: false,
        })
      } catch (cancel) {
        return
      }

      try {
        state.disabled = true
        const resp = await $apollo.mutate({
          mutation: deleteDatasetQuery,
          variables: {
            id: props.dataset.id,
            force,
          },
        })
        emit('datasetMutated')
      } catch (err) {
        state.disabled = false
        reportError(err, 'Deletion failed :( Please contact us at contact@metaspace2020.eu')
      }
    }

    const handleReprocess = async(e: Event) => {
      e.preventDefault()
      try {
        state.disabled = true
        await $apollo.mutate({
          mutation: reprocessDatasetQuery,
          variables: {
            id: props.dataset.id,
            useLithops: config.features.lithops,
          },
        })
        $notify.success('Dataset sent for reprocessing')
        emit('datasetMutated')
      } catch (err) {
        reportError(err)
      } finally {
        state.disabled = false
      }
    }

    const openMetadataDialog = (e: Event) => {
      e.preventDefault()
      state.showMetadataDialog = true
    }

    const closeMetadataDialog = () => {
      state.showMetadataDialog = false
    }

    const openDownloadDialog = (e: Event) => {
      e.preventDefault()
      state.showDownloadDialog = true
    }

    const closeDownloadDialog = () => {
      state.showDownloadDialog = false
    }

    const publicationStatus = computed(() => {
      if (props.dataset.projects.some(({ publicationStatus }) => publicationStatus === 'PUBLISHED')) {
        return 'Published'
      }
      if (props.dataset.projects.some(({ publicationStatus }) => publicationStatus === 'UNDER_REVIEW')) {
        return 'Under review'
      }
      return null
    })

    const canEdit = computed(() =>
      props.currentUser?.role === 'admin'
      || (props.currentUser?.id === props.dataset.submitter.id
      && (props.dataset.status !== 'QUEUED' && props.dataset.status !== 'ANNOTATING')),
    )

    const canDelete = computed(() =>
      props.currentUser?.role === 'admin'
      || (canEdit.value && publicationStatus.value === null),
    )

    const canReprocess = computed(() => props.currentUser?.role === 'admin')

    const canViewPublicationStatus = computed(() =>
      props.dataset.status === 'FINISHED'
      && canEdit.value
      && publicationStatus.value != null,
    )

    return () => {
      const { dataset, metadata, currentUser } = props

      return (
        <div class="ds-actions">
          <el-dialog
            title="Provided metadata"
            lock-scroll={false}
            visible={state.showMetadataDialog}
            onClose={closeMetadataDialog}
          >
            <DatasetInfo
              metadata={metadata}
              currentUser={currentUser}
            />
          </el-dialog>

          {state.showDownloadDialog
          && <DownloadDialog
            datasetId={dataset.id}
            datasetName={dataset.name}
            onClose={closeDownloadDialog}
          />}

          {dataset.status === 'FINISHED'
          && <span>
            <i class="el-icon-picture" />
            <el-popover
              trigger="hover"
              placement="top"
            >
              <div class="db-link-list">
              Select a database:
                {dataset.databases.map(db => (
                  <div key={db.id}>
                    <FilterLink filter={{ database: db.id, datasetIds: [dataset.id] }}>
                      {formatDatabaseLabel(db)}
                    </FilterLink>
                  </div>
                ))}
              </div>
              <a slot="reference">Browse annotations</a>
            </el-popover>
            <br />
          </span>}

          {dataset.status === 'ANNOTATING'
          && <span>
            <div
              class="striped-progressbar processing"
              title="Processing is under way"
            />
          </span>}

          {dataset.status === 'QUEUED'
          && <span>
            <div
              class="striped-progressbar queued"
              title="Waiting in the queue"
            />
          </span>}

          <div>
            <i class="el-icon-view" />
            <a
              href="#"
              onClick={openMetadataDialog}
            >Show full metadata</a>
          </div>

          {canEdit.value
          && <div>
            <i class="el-icon-edit" />
            <router-link to={{
              name: 'edit-metadata',
              params: { dataset_id: props.dataset.id },
            }}>
              Edit metadata
            </router-link>
          </div>}

          {
            !props?.showOverview && dataset.canDownload
          && <div class="ds-download">
            <i class="el-icon-download" />
            <a
              href="#"
              onClick={openDownloadDialog}
            >Download</a>
          </div>}

          {
            !props?.showOverview && canDelete.value
          && <div class="ds-delete">
            <i class="el-icon-delete" />
            <a
              href="#"
              class="text-danger"
              onClick={openDeleteDialog}
            >Delete dataset</a>
          </div>}

          {
            !props?.showOverview
            && canReprocess.value
          && <div class="ds-reprocess">
            <i class="el-icon-refresh" />
            <a
              href="#"
              class="text-danger"
              onClick={handleReprocess}
            >Reprocess dataset</a>
          </div>}

          {!canReprocess.value && canViewPublicationStatus.value
          && <div class="mt-auto text-right text-gray-700 text-sm test-publication-status">
            {publicationStatus.value}
          </div>}

          <div>
            <i class="el-icon-data-analysis" />
            <router-link to={{
              name: 'dataset-overview',
              params: { dataset_id: props.dataset.id },
            }}>
              Dataset overview
            </router-link>
          </div>
        </div>
      )
    }
  },
})

export default DatasetItemActions
