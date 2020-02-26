import { mount, Stubs } from '@vue/test-utils'
import Vue from 'vue'
import ElapsedTime from './ElapsedTime'

const TestElapsedTime = Vue.component('test', {
  functional: true,
  render: (h, { props }) => h(ElapsedTime, { props }),
})

/**
  N.B. Date formats are currently relying on Node version <12's fixed locale of en-US.
  See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleDateString#Browser_compatibility
**/

describe('ElapsedTime', () => {
  it('should render correctly', () => {
    const spy = jest.spyOn(global.Date, 'now').mockImplementation(() => new Date('2020-01-03T00:00:00.000').valueOf())
    const propsData = { date: '2020-01-02T00:00:00.000' }

    const wrapper = mount(TestElapsedTime, { propsData })

    expect(wrapper.text()).toEqual('1 day ago')
    expect(wrapper.attributes().title).toEqual('1/2/2020, 00:00')

    spy.mockRestore()
  })

  it('should render placeholder content when date is not provided', () => {
    const wrapper = mount(TestElapsedTime, { propsData: { date: '' } })
    expect(wrapper.text()).toEqual('some time ago')
    expect(wrapper.attributes().title).toEqual('Date unavailable')
  })
})
