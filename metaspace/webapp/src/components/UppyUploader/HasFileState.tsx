import { createComponent, reactive } from '@vue/composition-api'

import '../../components/ColourIcon.css'
import FileIcon from '../../assets/inline/refactoring-ui/document.svg'
import FadeTransition from '../../components/FadeTransition'
import ProgressRing from '../../components/ProgressRing'

interface State {
  progress: number
}

interface Props {
  disabled: boolean
  fileName: string
  progress: number
  removeFile?: () => void
}

export default createComponent<Props>({
  props: {
    fileName: String,
    progress: Number,
    removeFile: Function,
    disabled: Boolean,
  },
  setup(props) {
    return () => (
      <div class={['text-sm leading-5 transition-opacity duration-300', props.disabled && 'opacity-50']}>
        <div class="relative mt-3">
          <FileIcon class="sm-colour-icon sm-colour-icon--large" />
          <ProgressRing
            class={[
              'absolute top-0 left-0',
              props.progress === 100 ? 'text-success' : 'text-primary',
            ]}
            radius={24}
            stroke={4}
            progress={props.progress}
          />
          <FadeTransition class="absolute top-0 right-0 -mt-3 -mr-6">
            { props.progress === 100
              ? <button
                class="button-reset text-gray-600 hover:text-primary focus:text-primary"
                title="Remove file"
                onClick={props.removeFile}
                disabled={!props.removeFile}
              >
                <i class="el-icon-error text-inherit text-lg"></i>
              </button>
              : <span>{props.progress}%</span> }
          </FadeTransition>
        </div>
        <p class="m-0 mt-3 font-medium">
          {props.fileName}
        </p>
      </div>
    )
  },
})