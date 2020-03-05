import './review.css'

// import Vue from 'vue'
import { createComponent, computed, reactive } from '@vue/composition-api'
import { Button, Input, Collapse, CollapseItem } from 'element-ui'

import CopyToClipboard from '../../components/CopyToClipboard'

import { ViewProjectResult } from '../../api/project'

const statuses = {
  UNPUBLISHED: 'UNPUBLISHED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PUBLISHED: 'PUBLISHED',
}

const WorkflowItem = createComponent({
  props: {
    active: Boolean,
    done: Boolean,
  },
  setup(props, { slots }) {
    return () => (
      <li class={{ active: props.active, done: props.done }}>
        {slots.default()}
      </li>
    )
  },
})

function getInitialProjectData(project: ViewProjectResult, currentUserName = '') {
  const year = new Date().getFullYear()
  const nameParts = currentUserName.split(' ')
  const surname = nameParts.length ? nameParts[nameParts.length - 1] : null
  const citation = `${surname} et al. (${year})`
  const newProjectName = surname && !project.name.startsWith(citation) ? `${citation} ${project.name}` : null
  return {
    name: newProjectName || project.name,
    url: surname ? `${surname.toLowerCase()}-${year}` : project.urlSlug,
    description: project.projectDescriptionAsHtml,
  }
}

interface Props {
  project: ViewProjectResult
  currentUserName: string,

  createLink: Function,
  deleteLink: Function,
  publishProject: Function,
}

const ReviewLink = createComponent<Props>({
  props: {
    project: Object,
    createLink: Function,
    deleteLink: Function,
    publishProject: Function,
    currentUserName: String,
  },
  setup(props, { root }) {
    const reviewLink = computed(() => {
      if (!props.project || !props.project.reviewToken) {
        return undefined
      }
      return `${window.location.origin}/api_auth/review?prj=${props.project.id}&token=${props.project.reviewToken}`
    })

    const activeStep = computed(() => {
      if (!props.project) {
        return 1
      }
      return Object.keys(statuses).indexOf(props.project.publicationStatus) + 1
    })

    const state = reactive({
      loading: false,
      updateProject: false,
      projectData: getInitialProjectData(props.project, props.currentUserName),
    })

    const withLoading = (cb: Function | undefined) => {
      return async() => {
        if (!cb) return
        state.loading = true
        await cb()
        state.loading = false
      }
    }

    const enablePeerReview = withLoading(() => {
      if (props.createLink) {
        props.createLink(state.updateProject ? state.projectData : null)
      }
    })

    const { href } = root.$router.resolve({ name: 'project', params: { projectIdOrSlug: 'REMOVE' } }, undefined, true)
    const projectUrlPrefix = location.origin + href.replace('REMOVE', '')

    return () => (
      <ol class="sm-workflow">
        <WorkflowItem
          active={activeStep.value === 1}
          done={activeStep.value > 1}
        >
          <h2 class="sm-workflow-header">Enable peer review</h2>
          <p>
            A review link allows reviewers to access this project and its datasets <strong>without making the project available to everyone</strong>.
          </p>
          <p>
            <em>Reviewers will not need to create an account to gain access.</em>
          </p>
          {activeStep.value === 1
            && <form>
              <Collapse value={state.updateProject ? 'projectdetails' : ''} onChange={() => { state.updateProject = !state.updateProject }}>
                <CollapseItem title="Update project details (recommended)" name="projectdetails">
                  <label for="project-review-title">Set the project name:</label>
                  <Input id="project-review-title" value={state.projectData.name} />
                  <label for="project-review-url">Create a custom URL:</label>
                  <Input id="project-review-url" value={state.projectData.url}>
                    <span slot="prepend">{projectUrlPrefix}</span>
                  </Input>
                  <label for="project-review-description">Add an abstract to the project description:</label>
                  <Input id="project-review-description" value={state.projectData.description} type="textarea" rows="4" />
                </CollapseItem>
              </Collapse>
              <Button
                loading={state.loading}
                onClick={enablePeerReview}
                type="primary"
              >
                Create link {state.updateProject && '& update details'}
              </Button>
            </form>
          }
          {activeStep.value === 2
            && <form>
              <Button onClick={props.deleteLink} type="info">
                Remove link
              </Button>
            </form>
          }
        </WorkflowItem>
        <WorkflowItem
          active={activeStep.value === 2}
          done={activeStep.value > 2}
        >
          <h2 class="sm-workflow-header">Review in progress</h2>
          {activeStep.value === 2
            ? <form>
              <p>Reviewers can access this project using the following link:</p>
              <CopyToClipboard value={reviewLink.value} />
              <p>Once review is complete, we encourage making data publicly available.</p>
              <Button onClick={props.publishProject} type="primary">
                Publish project
              </Button>
            </form>
            : <p>Reviewers will have access to this project prior to publication.</p>
          }
        </WorkflowItem>
        <WorkflowItem
          active={activeStep.value === 3}
          done={activeStep.value === 3}
        >
          <h2 class="sm-workflow-header">Publish the data</h2>
          {activeStep.value === 3
            ? <p>This project and its datasets are now public, thank you for your contribution.</p>
            : <p>This project and its datasets will be made public.</p>}
        </WorkflowItem>
      </ol>
    )
  },
})

export default ReviewLink
