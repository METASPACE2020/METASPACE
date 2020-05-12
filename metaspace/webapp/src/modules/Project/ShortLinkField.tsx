import { createComponent } from '@vue/composition-api'
import { Input } from 'element-ui'

import * as Form from '../../components/Form'
import router from '../../router'

const { href } = router.resolve({ name: 'project', params: { projectIdOrSlug: 'REMOVE' } }, undefined, true)
const PROJECT_URL_PREFIX = location.origin + href.replace('REMOVE', '')

interface Props {
  error: string
  label: string
  value: string
}

const ShortLinkField = createComponent<Props>({
  inheritAttrs: false,
  props: {
    error: String,
    label: { type: String, default: 'Short link' },
    value: String,
  },
  setup(props, { attrs, listeners }) {
    return () => (
      <div>
        <label for={attrs.id}>
          <Form.PrimaryLabelText>
            { props.label }
          </Form.PrimaryLabelText>
          <Form.SecondaryLabelText>
            Must be unique, min. 4 characters, using a&ndash;z, 0&ndash;9, hyphen or underscore
          </Form.SecondaryLabelText>
          { props.error
            && <Form.ErrorLabelText>
              { props.error }
            </Form.ErrorLabelText> }
        </label>
        <Input
          class={{ 'sm-form-error': props.error }}
          disabled={attrs.disabled}
          id={attrs.id}
          maxlength="50"
          minlength="4"
          onInput={listeners.input}
          pattern="[a-zA-Z0-9_-]+"
          title="min. 4 characters, a–z, 0–9, hyphen or underscore"
          value={props.value}
        >
          <span slot="prepend">{PROJECT_URL_PREFIX}</span>
        </Input>
      </div>
    )
  },
})

export default ShortLinkField
