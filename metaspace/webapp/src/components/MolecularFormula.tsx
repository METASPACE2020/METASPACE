import { defineComponent, computed } from '@vue/composition-api'

import { superscript } from '../lib/util'

const MolecularFormula = defineComponent({
  props: {
    ion: { type: String, required: true },
  },
  setup(props) {
    const formulaAndCharge = computed(() => {
      const match = /^(.*?)([+-]\d*)?$/.exec(props.ion)
      const formula = match && match[1] || props.ion
      const charge = match && match[2] || undefined
      return { formula, charge }
    })

    const fmtCharge = computed(() => {
      const { charge } = formulaAndCharge.value
      if (charge !== undefined) {
        return superscript(charge)
      }
      return ''
    })

    const parts = computed<string[]>(() => {
      const { formula } = formulaAndCharge.value
      const fmtFormula = formula.replace(/-/g, ' - ').replace(/\+/g, ' + ')
      return fmtFormula.split(/(\d+)/g)
    })

    return () => (
      <span>
        [{parts.value.map((p, i) => {
          if (i % 2 !== 0) {
            return <sub>{p}</sub>
          }
          return p
        })}]{fmtCharge.value}
      </span>
    )
  },
})

export default MolecularFormula
