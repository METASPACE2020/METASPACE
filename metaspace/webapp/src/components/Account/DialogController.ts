import Vue, { CreateElement, Component as VueComponent } from 'vue';
import { Component } from 'vue-property-decorator';
import { DialogType } from './dialogs';
import { AccountState } from '../../store/accountModule';
import SignInDialog from './SignInDialog.vue';
import CreateAccountDialog from './CreateAccountDialog.vue';
import ForgotPasswordDialog from './ForgotPasswordDialog.vue';

const dialogComponents: Record<DialogType, VueComponent> = {
  'signIn': SignInDialog,
  'createAccount': CreateAccountDialog,
  'forgotPassword': ForgotPasswordDialog,
};

@Component
export default class extends Vue {
  get accountState() {
    return this.$store.state.account as AccountState;
  }
  render(h: CreateElement) {
    const dialog = this.accountState.dialog;
    const DialogComponent = dialog == null ? null : dialogComponents[dialog];

    return DialogComponent == null ? null : h(DialogComponent);
  }
  created(this: Vue) {
    const dialog = (this.$route.matched[0] as any).dialogType;

    this.$store.commit('account/showDialogAsPage', dialog);
  }
}
