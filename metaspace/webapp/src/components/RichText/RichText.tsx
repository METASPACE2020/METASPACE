import { createComponent, onMounted, onBeforeUnmount, reactive } from '@vue/composition-api'
import { EditorContent } from 'tiptap'
import { debounce } from 'lodash-es'

import FadeTransition from '../../components/FadeTransition'
import MenuBar from './MenuBar'

import useEditor from './useEditor'
import { OnEscape } from './tiptap'

interface Props {
  content: string
  formMode: boolean
  onUpdate: (content: string) => any
  readonly: boolean
}

const RichText = createComponent<Props>({
  props: {
    content: String,
    readonly: Boolean,
    onUpdate: Function,
  },
  setup(props) {
    const state = reactive({
      editing: !props.content,
      editor: useEditor({
        extensions: [
          new OnEscape(() => {
            state.editing = false
            state.editor.blur()
          }),
        ],
        editable: !props.readonly,
        content: props.content,
        onUpdate: props.onUpdate,
      }),
    })

    const { editor } = state

    const handleEditorClick = (e: Event) => {
      e.stopPropagation()
      if (!props.readonly && !state.editing) {
        state.editing = true
        editor.focus()
      }
    }

    const onOutclick = () => { state.editing = false }

    onMounted(() => {
      document.body.addEventListener('click', onOutclick)
    })

    onBeforeUnmount(() => {
      document.body.removeEventListener('click', onOutclick)
    })

    return () => (
      <section class="sm-RichText" onClick={handleEditorClick}>
        {!props.readonly && (
          <header class="flex items-baseline h-8 mb-2">
            <FadeTransition>
              {state.editing
                ? <MenuBar editor={editor} />
                : <p class="text-sm italic text-gray-700 px-4 leading-6">
                  <i class="el-icon-edit" /> click to edit
                </p>}
            </FadeTransition>
          </header>
        )}
        <EditorContent
          class={[
            'p-4 transition-colors ease-in-out duration-300 rounded',
            { 'bg-transparent': !state.editing },
            { 'bg-gray-200': state.editing },
          ]}
          editor={editor}
        />
      </section>
    )
  },
})

export default RichText
