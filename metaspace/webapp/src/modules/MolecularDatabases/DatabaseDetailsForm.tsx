import { defineComponent, reactive } from '@vue/composition-api'

import { PrimaryLabelText, SecondaryLabelText } from '../../components/Form'
import FadeTransition from '../../components/FadeTransition'
import { RichTextArea } from '../../components/RichText'

import { MolecularDB, MolecularDBDetails, UpdateDatabaseDetailsMutation } from '../../api/moldb'
import { formatDatabaseLabel, getDatabaseDetails } from './formatting'

interface State {
  model: MolecularDBDetails,
  loading: boolean,
}

interface Props {
  db: MolecularDB,
  submit: (update: UpdateDatabaseDetailsMutation) => void
}

const Details = defineComponent<Props>({
  props: {
    db: { type: Object, required: true },
    submit: { type: Function, required: true },
  },
  setup(props, { root }) {
    const state = reactive<State>({
      model: getDatabaseDetails(props.db),
      loading: false,
    })

    const handleFormSubmit = async(e: Event) => {
      e.preventDefault()
      try {
        state.loading = true
        await props.submit({ id: props.db.id, details: state.model })
        root.$message({ message: `${formatDatabaseLabel(props.db)} updated`, type: 'success' })
      } catch (e) {
        root.$message({ message: 'Something went wrong, please try again later', type: 'error' })
      } finally {
        state.loading = false
      }
    }

    return () => (
      <form class="sm-form v-rhythm-6" action="#" onSubmit={handleFormSubmit}>
        <div>
          <label for="database-full-name">
            <PrimaryLabelText>Full name</PrimaryLabelText>
          </label>
          <el-input
            id="database-full-name"
            v-model={state.model.fullName}
          />
        </div>
        <RichTextArea
          content={state.model.description}
          onUpdate={(content: string) => {
            if (state.model) {
              state.model.description = content
            }
          }}
        >
          <PrimaryLabelText slot="label">Description</PrimaryLabelText>
        </RichTextArea>
        <div class="flex items-center">
          <el-switch
            id="database-public"
            v-model={state.model.isPublic}
            class="mr-6"
          />
          <FadeTransition class="duration-200 cursor-pointer">
            {state.model.isPublic
              ? <label key="public" for="database-public">
                <PrimaryLabelText>Annotations are public</PrimaryLabelText>
                <SecondaryLabelText>Results will be visible to everyone</SecondaryLabelText>
              </label>
              : <label key="private" for="database-public">
                <PrimaryLabelText>Annotations are private</PrimaryLabelText>
                <SecondaryLabelText>Results will be visible to group members only</SecondaryLabelText>
              </label> }
          </FadeTransition>
        </div>
        <div>
          <label for="database-link">
            <PrimaryLabelText>Link</PrimaryLabelText>
          </label>
          <el-input id="database-link" v-model={state.model.link}/>
        </div>
        <RichTextArea
          content={state.model.citation}
          onUpdate={(content: string) => {
            if (state.model) {
              state.model.citation = content
            }
          }}
        >
          <PrimaryLabelText slot="label">Citation</PrimaryLabelText>
        </RichTextArea>
        <button class="el-button el-button--primary">
          Update details
        </button>
      </form>
    )
  },
})

export default Details