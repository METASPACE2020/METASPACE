import './NewFeatureBadge.css'

import { createComponent, reactive } from '@vue/composition-api'

import { getLocalStorage, setLocalStorage } from '../../lib/localStorage'

const storageKey = 'new_feature_badges'

const store: { [key: string]: boolean } = reactive(
  getLocalStorage(storageKey) || {},
)

export function hideFeatureBadge(featureKey: string) {
  if (store[featureKey]) {
    return
  }
  store[featureKey] = true
  setLocalStorage(storageKey, store)
}

const NewFeatureBadge = createComponent({
  props: {
    featureKey: { type: String, required: true },
    showUntil: Date as any as () => Date,
  },
  setup(props, { slots }) {
    const isStale = props.showUntil && props.showUntil.valueOf() < Date.now()
    if (store[props.featureKey] || isStale) {
      return () => slots.default()
    }
    return () => (
      <el-badge
        value="New"
        class={['sm-feature-badge', { 'sm-feature-badge--hidden': store[props.featureKey] }]}
      >
        {slots.default()}
      </el-badge>
    )
  },
})

export default NewFeatureBadge