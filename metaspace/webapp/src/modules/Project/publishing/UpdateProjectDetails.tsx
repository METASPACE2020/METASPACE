import { createComponent, reactive } from '@vue/composition-api'
import { Button, Input } from 'element-ui'

import { WorkflowStep } from '../../../components/Workflow'
import { RichTextArea } from '../../../components/RichText'
import CopyToClipboard from '../../../components/CopyToClipboard'
import FadeTransition from '../../../components/FadeTransition'
import ShortLinkField from '../ShortLinkField'

import { ViewProjectResult } from '../../../api/project'
import { parseValidationErrors } from '../../../api/validation'

import router from '../../../router'

function getInitialModel(project: ViewProjectResult, currentUserName = '') {
  const year = new Date().getFullYear()
  const nameParts = currentUserName.split(' ')
  const surname = nameParts.length ? nameParts[nameParts.length - 1] : null
  const citation = `${surname} et al. (${year})`
  const newProjectName = surname && !project.name.startsWith(citation) ? `${citation} ${project.name}` : null
  return {
    name: newProjectName || project.name,
    urlSlug: surname && !project.urlSlug ? `${surname.toLowerCase()}-${year}` : project.urlSlug,
    projectDescription: project.projectDescription,
  }
}

interface Props {
  active: boolean
  updateProject: Function
  currentUserName: string
  done: boolean
  project: ViewProjectResult
}

interface State {
  editing: boolean
  errors: { [field: string]: string }
  loading: boolean
  model: {
    name: string,
    urlSlug: string | null,
    projectDescription: string | null
  }
}

const PrepareProject = createComponent<Props>({
  props: {
    active: Boolean,
    currentUserName: String,
    done: Boolean,
    project: Object,
    updateProject: Function,
  },
  setup(props) {
    const state = reactive<State>({
      editing: false,
      errors: {},
      loading: false,
      model: getInitialModel(props.project, props.currentUserName),
    })

    const submit = async() => {
      if (props.updateProject) {
        state.errors = {}
        state.loading = true
        try {
          await props.updateProject(state.model)
          state.editing = false
        } catch (e) {
          state.errors = parseValidationErrors(e)
        } finally {
          state.loading = false
        }
      }
    }

    const cancel = () => {
      state.editing = false
      state.errors = {}
      state.model = getInitialModel(props.project, props.currentUserName)
    }

    const { href } = router.resolve({ name: 'project', params: { projectIdOrSlug: 'REMOVE' } }, undefined, true)
    const projectUrlPrefix = location.origin + href.replace('REMOVE', '')

    return () => (
      <WorkflowStep
        active={props.active}
        done={props.done}
      >
        <h2 class="sm-workflow-header">Update project details</h2>
        <FadeTransition>
          {(props.active || state.editing)
            && <form
              key="editing"
              class="sm-form"
              action="#"
              onSubmit={(e: Event) => { e.preventDefault(); submit() }}
            >
              <p>
                Create a short project link to use in the manuscript.
                We also suggest updating the project title and adding an abstract to the project description.
              </p>
              <ShortLinkField
                v-model={state.model.urlSlug}
                id="publishing-project-link"
                label="Link to be used in the manuscript"
                error={state.errors.urlSlug}
              />
              <div>
                <label for="project-review-title">
                  <span class="text-base font-medium">Project title</span>
                  <span class="block text-sm text-gray-800">
                    Suggested format: Author et al. (year) title
                  </span>
                </label>
                <Input id="project-review-title" class="py-1" v-model={state.model.name} />
              </div>
              <RichTextArea
                content={state.model.projectDescription}
                onUpdate={(content: string) => {
                  state.model.projectDescription = content
                }}
              >
                <span slot="label" class="text-base font-medium">Abstract</span>
                <span slot="label" class="block text-sm text-gray-800">
                  Copy and paste here, will be displayed in the About section
                </span>
              </RichTextArea>
              {/* Button component does not submit the form *shrug* */}
              <button class="el-button el-button--primary">
                {state.loading && <i class="el-icon-loading" />}
                <span>
                  Update
                </span>
              </button>
              { state.editing
              && <Button
                key="cancel"
                type="text"
                nativeType="reset"
                class="px-3"
                onClick={cancel}
              >
                Cancel
              </Button> }
            </form>}
          { props.done && !state.editing
          && <form
            key="done"
            action="#"
            onSubmit={(e: Event) => { e.preventDefault(); submit() }}
          >
            <label>
              <span class="font-medium text-primary">Reference the project in the manuscript using this link:</span>
              <CopyToClipboard value={projectUrlPrefix + props.project.urlSlug} class="py-1" />
            </label>
            <Button
              key="edit"
              onClick={() => { state.editing = true }}
            >
              Edit details
            </Button>
          </form>}
        </FadeTransition>
      </WorkflowStep>
    )
  },
})

export default PrepareProject
