import { mount, Wrapper } from '@vue/test-utils';
import VueRouter from 'vue-router';
import ElementUI from 'element-ui';
import Vuex from 'vuex';
import Vue from 'vue';
import TransferDatasetsDialog from './TransferDatasetsDialog.vue';
import router from '../../router';
import registerMockComponent from '../../../tests/utils/registerMockComponent';
jest.mock('../../components/DatasetItem.vue', () => require('../../../tests/utils/mockComponent')('dataset-item'));

Vue.use(ElementUI);
registerMockComponent('el-dialog');
Vue.use(VueRouter);
Vue.use(Vuex);

describe('TransferDatasetsDialog', () => {
  const mockDatasets = [
    { "id": "2018-06-28_13h23m10s", "name": "Untreated_3_434", "uploadDT": "2018-06-28T13:23:10.837000" },
    { "id": "2018-06-28_13h21m36s", "name": "Dataset 2", "uploadDT": "2018-06-28T13:21:36.973867" },
    { "id": "2018-06-28_12h03m36s", "name": "Dataset 3", "uploadDT": "2018-06-28T12:03:36.409743" },
    { "id": "2018-06-28_13h20m44s", "name": "Dataset 4", "uploadDT": "2018-06-28T13:20:44.736472" },
  ];
  const mockProps = {
    currentUserId: 'current user id',
    groupName: 'Group Name',
    isInvited: true
  };
  [false, true].forEach(hasDatasets => {
    [false, true].forEach(isInvited => {
      it(`should match snapshot (${hasDatasets ? 'datasets to import' : 'no datasets'}, ${isInvited ? 'invited' : 'requesting access'})`, () => {
        const propsData = { ...mockProps, isInvited };
        const wrapper = mount(TransferDatasetsDialog, { router, propsData });
        wrapper.setData({ allDatasets: hasDatasets ? mockDatasets : [] });

        expect(wrapper).toMatchSnapshot();
      });
    })
  });

  it('should call back on success when some datasets are selected', async () => {
    const wrapper = mount(TransferDatasetsDialog, { router, propsData: mockProps });
    wrapper.setData({ allDatasets: mockDatasets });

    wrapper.find(ElementUI.Checkbox).trigger('click');
    wrapper.findAll(ElementUI.Button)
      .filter((b: Wrapper<ElementUI.Button>) => b.props().type === 'primary')
      .at(0)
      .trigger('click');
    await Vue.nextTick();

    expect(wrapper.emitted('accept')).toEqual([
      [mockDatasets.slice(1).map(ds => ds.id)]
    ])
  })

});
