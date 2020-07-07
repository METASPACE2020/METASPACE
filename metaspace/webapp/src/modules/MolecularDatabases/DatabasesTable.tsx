import { createComponent, createElement, reactive, onBeforeMount } from '@vue/composition-api'
import { useQuery } from '@vue/apollo-composable'

import '../../components/ColourIcon.css'
import GroupIcon from '../../assets/inline/refactoring-ui/group.svg'

import '../../components/MiniIcon.css'
import CheckIcon from '../../assets/inline/refactoring-ui/check.svg'

import UploadDialog from './UploadDialog'

import { getGroupDatabasesQuery } from '../../api/group'
import ElapsedTime from '../../components/ElapsedTime'
import { MolecularDB } from '../../api/moldb'

const DatabasesTable = createComponent({
  props: {
    handleRowClick: { type: Function, required: true },
    groupId: { type: String, required: true },
  },
  setup(props) {
    const state = reactive({
      showUploadDialog: false,
    })

    const { result, loading, refetch } = useQuery(
      getGroupDatabasesQuery,
      { groupId: props.groupId },
      { fetchPolicy: 'no-cache' },
    )

    onBeforeMount(refetch)

    const onDialogClose = () => {
      state.showUploadDialog = false
    }

    const onUploadComplete = () => {
      onDialogClose()
      refetch()
    }

    return () => (
      <div>
        <header class="flex justify-between items-center py-3">
          <div class="flex items-center">
            <GroupIcon class="sm-colour-icon mx-3 w-6 h-6" />
            <p class="m-0 ml-1 text-sm leading-5 text-gray-700">
              Databases are only available to members of this group.
              <br />
              You can choose to make derived annotations visible to others.
            </p>
          </div>
          <el-button type="primary" onClick={() => { state.showUploadDialog = true }}>
            Upload Database
          </el-button>
        </header>
        <el-table
          v-loading={loading.value}
          data={result.value?.group?.molecularDatabases}
          default-sort={{ prop: 'createdDT', order: 'descending' }}
          style="width: 100%"
          on={{
            'row-click': props.handleRowClick,
          }}
          row-class-name="cursor-pointer"
        >
          {createElement('el-table-column', {
            props: {
              prop: 'name',
              label: 'Name',
              minWidth: 144,
              sortable: true,
              sortBy: ['name', 'version'],
            },
            scopedSlots: {
              default: ({ row }) => (
                <span>
                  <span class="text-body font-medium">{row.name}</span>
                  {' '}
                  <span class="text-gray-700">{row.version}</span>
                </span>
              ),
            },
          })}
          {createElement('el-table-column', {
            props: {
              prop: 'createdDT',
              label: 'Uploaded',
              minWidth: 144,
              sortable: true,
            },
            scopedSlots: {
              default: ({ row }) => (
                <ElapsedTime key={row.id} date={row.createdDT} />
              ),
            },
          })}
          {createElement('el-table-column', {
            props: {
              prop: 'isPublic',
              label: 'Results public',
              width: 144,
              align: 'center',
            },
            scopedSlots: {
              default: ({ row }) => (
                row.isPublic
                  ? <CheckIcon class="sm-mini-icon" />
                  : null
              ),
            },
          })}
          {createElement('el-table-column', {
            props: {
              prop: 'archived',
              label: 'Archived',
              width: 144,
              align: 'center',
            },
            scopedSlots: {
              default: ({ row }) => (
                row.archived
                  ? <CheckIcon class="sm-mini-icon" />
                  : null
              ),
            },
          })}
        </el-table>
        { state.showUploadDialog
          && <UploadDialog
            groupId={props.groupId}
            onClose={onDialogClose}
            onDone={onUploadComplete}
          /> }
      </div>
    )
  },
})

export default DatabasesTable