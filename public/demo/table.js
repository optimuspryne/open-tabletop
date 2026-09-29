import { applyIcons, setIcon } from '../ui/icons.js';
import { demoRequest, readDemoSession, writeDemoSession } from './session.js';

export function mountDemoTable(room, table) {
  const info = document.querySelector('#roomInfoNames');
  const code = document.querySelector('#roomCode');
  code.hidden = true;
  code.onclick = null;
  document.body.classList.add('demo-table');
  const status = document.createElement('span');
  status.className = 'demo-table-status';
  const invite = document.createElement('button');
  invite.className = 'button demo-invite';
  invite.type = 'button';
  invite.dataset.icon = 'users-plus';
  invite.innerHTML = '<span class="lbl">Invite friends</span>';
  info.append(status, invite);
  applyIcons(info);
  const leave = document.querySelector('#lobbyBtn');
  leave.querySelector('.lbl').textContent = 'Leave table';
  leave.setAttribute('aria-label', 'Leave table');
  setIcon(leave, 'logout');

  const dialog = document.createElement('dialog');
  dialog.className = 'demo-invite-dialog panel';
  dialog.setAttribute('aria-labelledby', 'demo-invite-heading');
  dialog.innerHTML = `<h2 id="demo-invite-heading">Invite friends</h2>
    <p>Anyone with this link can join your temporary table as a player.</p>
    <label for="demo-invite-link">Invite link</label><input id="demo-invite-link" readonly type="text">
    <p class="demo-invite-result" role="status" aria-live="polite"></p>
    <div class="demo-invite-actions"><button class="button" data-action="copy" data-icon="copy"><span class="lbl">Copy link</span></button>
    <button class="button" data-action="done">Done</button></div>
    <div data-host-only><p>Replace the link if it has been shared too widely. The old link will stop working; current players stay connected.</p>
    <button class="button" data-action="replace">Replace invite link</button></div>`;
  document.body.append(dialog);
  applyIcons(dialog);
  const field = dialog.querySelector('input');
  const note = dialog.querySelector('[role="status"]');
  const host = table.role === 'owner';
  dialog.querySelector('[data-host-only]').hidden = !host;
  function showLink() {
    const raw = readDemoSession().invite;
    field.value = raw ? `${location.origin}/#invite=${encodeURIComponent(raw)}` : '';
    dialog.querySelector('[data-action="copy"]').disabled = !raw;
    if (!raw)
      note.textContent = host
        ? 'Replace the link to create a new invitation.'
        : 'Ask the host for a new invite link.';
  }
  invite.onclick = () => {
    note.textContent = '';
    showLink();
    dialog.showModal();
    field.focus();
    field.select();
  };
  dialog.querySelector('[data-action="done"]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => invite.focus());
  dialog.querySelector('[data-action="copy"]').onclick = async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      note.textContent = 'Invite link copied.';
    } catch {
      field.focus();
      field.select();
      note.textContent = 'Select and copy the link above.';
    }
  };
  dialog.querySelector('[data-action="replace"]').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { invite } = await demoRequest('rotate');
      writeDemoSession({ ...readDemoSession(), invite });
      showLink();
      note.textContent = 'New invite link ready. The old link no longer works.';
    } catch {
      note.textContent = 'Could not replace the link. Please try again.';
    } finally {
      button.disabled = false;
    }
  };
  let warned = false;
  const update = () => {
    const left = Math.max(0, Math.ceil((new Date(table.expiresAt).getTime() - Date.now()) / 60000));
    status.textContent = `Public demo · ${Math.floor(left / 60)}h ${left % 60}m left`;
    if (left <= 5 && !warned) {
      warned = true;
      status.setAttribute('role', 'status');
      status.textContent += ' · Ends soon';
    }
  };
  update();
  const timer = setInterval(update, 10000);
  room.onMessage('demoExpired', () => location.replace('/?expired=1'));
  room.onLeave(() => {
    clearInterval(timer);
    dialog.remove();
    // Periodic session revalidation may disconnect before the demo sweeper's notice.
    // Distinguish expiry from a recoverable network drop without exposing raw errors.
    void demoRequest('resume').catch((error) => {
      if (error.code === 'expired') location.replace('/?expired=1');
    });
  });
}
