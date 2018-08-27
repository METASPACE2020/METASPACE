import { mount, Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import { restoreConsole, suppressConsoleWarn } from '../../../tests/utils/suppressConsole';
import EditUserPage from './EditUserPage.vue';
import router from '../../router';
import { initMockGraphqlClient, provide } from '../../../tests/utils/mockGraphqlClient';


describe('EditUserPage', () => {
  const mockCurrentUser = {
    id: '22333',
    name: 'foo',
    role: 'user',
    groups: [
      {role: 'MEMBER', numDatasets: 0, group: { id: 'AAA', name: 'Group A' }},
      {role: 'INVITED', numDatasets: 0, group: { id: 'BBB', name: 'Group B' }},
      {role: 'PENDING', numDatasets: 0, group: { id: 'CCC', name: 'Group C' }},
      {role: 'PRINCIPAL_INVESTIGATOR', numDatasets: 20, group: { id: 'DDD', name: 'Group D' }},
    ],
    primaryGroup: {role: 'PRINCIPAL_INVESTIGATOR', numDatasets: 20, group: { id: 'DDD', name: 'Group D' }},
    projects: [
      {role: 'MEMBER', numDatasets: 0, project: { id: 'AA', name: 'Project A' }},
      {role: 'INVITED', numDatasets: 0, project: { id: 'BB', name: 'Project B' }},
      {role: 'PENDING', numDatasets: 0, project: { id: 'CC', name: 'Project C' }},
      {role: 'MANAGER', numDatasets: 20, project: { id: 'DD', name: 'Project D' }},
    ],
  };

  const mockUpdateUserMutation = jest.fn(() => ({}));

  beforeAll(() => {
    initMockGraphqlClient({
      Query: () => ({
        currentUser: () => mockCurrentUser
      }),
      Mutation: () => ({
        updateUser: mockUpdateUserMutation
      })
    });
  });

  beforeEach(() => {
    // suppressConsoleWarn('async-validator:');
  });

  afterEach(async () => {
    restoreConsole();
  });

  it('should match snapshot', async () => {
    const wrapper = mount(EditUserPage, { router, provide, sync: false });
    await Vue.nextTick();

    expect(wrapper).toMatchSnapshot();
  });

  it('should be able to submit changes to the user', async () => {
    const wrapper = mount(EditUserPage, { router, provide, sync: false });
    await Vue.nextTick();
    const nameInput = wrapper.find('input[name="name"]');
    const emailInput = wrapper.find('input[name="email"]');
    const saveButton = wrapper.find('.saveButton');
    const name = 'foo bar';
    const email = 'foo@bar.baz';
    wrapper.vm.$confirm = jest.fn(() => Promise.resolve());
    await Vue.nextTick();

    nameInput.setValue(name);
    emailInput.setValue(email);
    saveButton.trigger('click');
    await Vue.nextTick();

    expect(mockUpdateUserMutation).toBeCalled();
    expect(mockUpdateUserMutation.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        userId: mockCurrentUser.id,
        update: expect.objectContaining({ name, email }),
      })
    );
  });
});
