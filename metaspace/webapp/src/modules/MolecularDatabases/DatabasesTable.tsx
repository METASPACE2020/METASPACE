import { createComponent, createElement } from '@vue/composition-api'

const DatabasesTable = createComponent({
  props: {
    databases: Array,
  },
  setup(props) {
    return () => (
      <el-table
        data={props.databases}
        style="width: 100%"
      >
        {createElement('el-table-column', {
          props: {
            label: 'Name',
            minWidth: 100,
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
        <el-table-column
          prop="uploadDT"
          label="Uploaded"
          width={150}
        />
        <el-table-column
          prop="molecules"
          label="Molecules"
          align="right"
          width={150}
        />
        <el-table-column
          prop="annotations"
          label="Annotations"
          align="right"
          width={150}
        />
        <el-table-column
          prop="archived"
          label="Rxiv'd"
          align="center"
          width={75}
        />
        <el-table-column
          prop="public"
          label="Public"
          align="center"
          width={75}
        />
      </el-table>
    )
  },
})

export default DatabasesTable
