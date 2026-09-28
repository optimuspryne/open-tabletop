import { passwordError } from '../shared/passwords.js';

// Account forms own their transient secrets. The landing controller owns navigation
// and the signed-in identity; nothing here is stored in browser storage except the
// normal replacement session token through the injected acceptSession callback.
export function createAccountSecurityUI({
  api,
  setView,
  showHome,
  showAuth,
  setStatus,
  acceptSession,
  requestHost,
}) {
  const byId = (id) => document.getElementById(id);
  const pages = [
    'securityOverview',
    'passwordForm',
    'recoveryView',
    'recoveryLinkView',
    'resetPasswordForm',
    'recoveryCodesView',
  ];
  let user = null;
  let grant = null;
  let link = null;
  let codes = [];
  let afterPassword = false;
  let generation = 0;
  let busy = false;
  function clear() {
    generation++;
    grant = null;
    link = null;
    codes = [];
    for (const input of byId('securityView').querySelectorAll('input')) input.value = '';
    byId('recoveryCodeList').textContent = '';
    for (const status of byId('securityView').querySelectorAll('[role="status"]'))
      setStatus(status, '');
  }
  function page(id) {
    generation++;
    setView('security');
    for (const name of pages) byId(name).hidden = name !== id;
    byId(id).querySelector('h1')?.focus();
  }
  async function run(errorId, work) {
    if (busy) return;
    busy = true;
    const version = generation;
    setStatus(byId(errorId), '');
    const buttons = [...byId('securityView').querySelectorAll('button')].filter(
      (button) => button.getClientRects().length,
    );
    const disabled = buttons.map((button) => button.disabled);
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      await work(() => version === generation);
    } catch (error) {
      if (version === generation) setStatus(byId(errorId), error.message);
    } finally {
      busy = false;
      buttons.forEach((button, i) => {
        button.disabled = disabled[i];
      });
    }
  }
  async function showSecurity(message = '') {
    clear();
    page('securityOverview');
    byId('securityPasswordBtn').disabled = true;
    byId('verifyEmailBtn').disabled = true;
    byId('generateCodesBtn').disabled = true;
    const version = generation;
    try {
      const status = await api('/auth/security', { auth: true });
      if (version !== generation) return;
      user = status.user;
      byId('securityPasswordState').textContent = user.hasPassword
        ? 'Password set'
        : 'No password set';
      byId('securityPasswordLabel').textContent = user.hasPassword
        ? 'Change password'
        : 'Set password';
      byId('securityEmailState').textContent =
        `${user.email} — ${status.emailVerified ? 'Verified' : 'Not verified'}`;
      byId('securityMailNote').textContent = status.emailRecoveryAvailable
        ? 'Verify this address to enable email recovery and password reset.'
        : 'Email recovery is not configured on this server. Save recovery codes instead.';
      byId('verifyEmailBtn').hidden = status.emailVerified || !status.emailRecoveryAvailable;
      byId('securityCodesState').textContent = status.codesRemaining
        ? `${status.codesRemaining} unused codes. Generating new codes replaces the previous set.`
        : 'No recovery codes saved. Generate a set and keep it somewhere safe.';
      setStatus(byId('securityStatus'), message, 'note');
      byId('securityPasswordBtn').disabled = false;
      byId('verifyEmailBtn').disabled = false;
      byId('generateCodesBtn').disabled = false;
    } catch (error) {
      if (version === generation) setStatus(byId('securityStatus'), error.message);
    }
  }
  function showPassword(currentUser, forHosting = false) {
    clear();
    user = currentUser;
    afterPassword = forHosting;
    page('passwordForm');
    byId('passwordHeading').textContent = user.hasPassword ? 'Change password' : 'Set a password';
    byId('currentPasswordRow').hidden = !user.hasPassword;
    byId('currentPassword').required = !!user.hasPassword;
    byId(user.hasPassword ? 'currentPassword' : 'newPassword').focus();
  }
  async function showRecovery() {
    clear();
    page('recoveryView');
    byId('recoveryEmailForm').hidden = true;
    const version = generation;
    try {
      const config = await api('/auth/security/config');
      if (version !== generation) return;
      byId('recoveryEmailForm').hidden = !config.emailRecoveryAvailable;
      byId('recoveryAvailability').textContent = config.emailRecoveryAvailable
        ? 'Use your verified email or one saved recovery code.'
        : 'Email recovery is unavailable on this server. Use a saved recovery code.';
    } catch {
      if (version === generation)
        setStatus(
          byId('recoveryEmailStatus'),
          'Could not check email availability. You can still use a recovery code.',
        );
    }
  }
  function showReset(result) {
    grant = result.grant;
    link = null;
    page('resetPasswordForm');
    byId('resetHeading').textContent = result.hasPassword
      ? 'Reset password'
      : 'Recover your account';
    byId('recoverWithoutPassword').hidden = result.hasPassword;
    byId('resetPasswordNote').textContent = result.hasPassword
      ? 'Choose a new password. Your other sessions and recovery codes will be revoked.'
      : 'You can set a password, or keep this account passwordless. Your other sessions and recovery codes will be revoked.';
    byId('resetPassword').focus();
  }
  async function complete(withPassword, current) {
    const body = { grant };
    if (withPassword) {
      body.password = byId('resetPassword').value;
      body.confirmation = byId('resetConfirmation').value;
      if (!validatePasswordFields('resetPassword', 'resetConfirmation', 'resetStatus', setStatus))
        return;
    }
    const result = await api('/auth/recovery/complete', { method: 'POST', body });
    acceptSession(result);
    if (current())
      await showSecurity(
        'Account recovered. Old sessions and recovery codes were revoked. Save new recovery codes below.',
      );
  }
  function submit(id, errorId, work) {
    byId(id).addEventListener('submit', (event) => {
      event.preventDefault();
      void run(errorId, work);
    });
  }
  submit('passwordForm', 'passwordStatus', async (current) => {
    if (!validatePasswordFields('newPassword', 'confirmPassword', 'passwordStatus', setStatus))
      return;
    const result = await api('/auth/password', {
      method: 'POST',
      auth: true,
      body: {
        password: byId('newPassword').value,
        confirmation: byId('confirmPassword').value,
        ...(user.hasPassword ? { currentPassword: byId('currentPassword').value } : {}),
      },
    });
    acceptSession(result);
    if (!current()) return;
    if (afterPassword) {
      clear();
      await requestHost();
    } else
      await showSecurity(
        'Password saved. Other sessions and recovery codes were revoked. Save new recovery codes below.',
      );
  });
  submit('recoveryEmailForm', 'recoveryEmailStatus', async (current) => {
    const result = await api('/auth/recovery/request', {
      method: 'POST',
      body: { email: byId('recoveryEmail').value.trim() },
    });
    if (current()) setStatus(byId('recoveryEmailStatus'), result.message, 'note');
  });
  submit('recoveryCodeForm', 'recoveryCodeStatus', async (current) => {
    const result = await api('/auth/recovery/exchange', {
      method: 'POST',
      body: { login: byId('recoveryLogin').value.trim(), code: byId('recoveryCode').value },
    });
    byId('recoveryCode').value = '';
    if (current()) showReset(result);
  });
  submit('resetPasswordForm', 'resetStatus', (current) => complete(true, current));
  byId('recoverWithoutPassword').onclick = () =>
    void run('resetStatus', (current) => complete(false, current));
  byId('securityPasswordBtn').onclick = () => showPassword(user);
  byId('passwordCancel').onclick = () => {
    afterPassword = false;
    void showSecurity();
  };
  byId('securityBack').onclick = async () => {
    clear();
    if (user) {
      await showHome(user);
      byId('securityBtn').focus();
    } else showAuth();
  };
  byId('recoveryBack').onclick = () => {
    clear();
    showAuth();
  };
  byId('resetCancel').onclick = () => void showRecovery();
  byId('linkCancel').onclick = () => {
    clear();
    showAuth();
  };
  byId('passwordResetLink').onclick = showRecovery;
  byId('verifyEmailBtn').onclick = () =>
    void run('securityStatus', async (current) => {
      const result = await api('/auth/recovery/verify/request', { method: 'POST', auth: true });
      if (current()) setStatus(byId('securityStatus'), result.message, 'note');
    });
  byId('generateCodesBtn').onclick = () =>
    void run('securityStatus', async (current) => {
      const result = await api('/auth/recovery/codes', { method: 'POST', auth: true });
      if (!current()) return;
      codes = result.codes;
      page('recoveryCodesView');
      byId('recoveryCodeList').textContent = codes.join('\n');
    });
  byId('copyCodesBtn').onclick = () =>
    void run('codesStatus', async () => {
      if (!navigator.clipboard)
        throw new Error('Copy is unavailable here. Select the codes or use Download.');
      await navigator.clipboard.writeText(codes.join('\n'));
      setStatus(byId('codesStatus'), 'Codes copied. Keep them private.', 'note');
    });
  byId('downloadCodesBtn').onclick = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          `Open Tabletop recovery codes\n${location.origin}\nEach code works once. Keep these private.\n\n${codes.join('\n')}\n`,
        ],
        { type: 'text/plain' },
      ),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'open-tabletop-recovery-codes.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  byId('codesDoneBtn').onclick = () => void showSecurity();
  byId('linkContinue').onclick = () =>
    void run('linkStatus', async (current) => {
      if (link?.purpose === 'verify') {
        await api('/auth/recovery/verify', {
          method: 'POST',
          auth: true,
          body: { token: link.token },
        });
        if (current()) await showSecurity('Recovery email verified.');
      } else {
        const result = await api('/auth/recovery/exchange', {
          method: 'POST',
          body: { token: link?.token },
        });
        if (current()) showReset(result);
      }
    });
  function openLink(fragment) {
    const params = new URLSearchParams(fragment.replace(/^#/, ''));
    const purpose = params.has('verify') ? 'verify' : params.has('recover') ? 'recover' : null;
    if (!purpose) return false;
    clear();
    link = { purpose, token: params.get(purpose) };
    history.replaceState(null, '', location.pathname + location.search);
    page('recoveryLinkView');
    byId('linkHeading').textContent =
      purpose === 'verify' ? 'Verify recovery email' : 'Recover account / reset password';
    byId('linkNote').textContent =
      purpose === 'verify'
        ? 'Continue in the browser where you requested verification and are still signed in.'
        : 'Continue to verify this single-use link. You can then reset your password or recover a passwordless account.';
    return true;
  }
  return { showSecurity, showPassword, showRecovery, openLink, clear };
}

export function validatePasswordFields(passwordId, confirmationId, statusId, setStatus) {
  const password = document.getElementById(passwordId);
  const confirmation = document.getElementById(confirmationId);
  const error = passwordError(password.value, confirmation.value);
  password.removeAttribute('aria-invalid');
  confirmation.removeAttribute('aria-invalid');
  if (!error) return true;
  const field = error === 'Passwords do not match.' ? confirmation : password;
  field.setAttribute('aria-invalid', 'true');
  setStatus(document.getElementById(statusId), error);
  field.focus();
  return false;
}
