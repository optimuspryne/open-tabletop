import { timerLive } from '../../shared/pieces.js';

// Format milliseconds as m:ss (or h:mm:ss past an hour), flooring to whole seconds.
function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  const s = total % 60,
    m = Math.floor(total / 60) % 60,
    h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function createTimer({
  getRoom,
  byId,
  setIcon,
  doc = document,
  now = Date.now,
  repeat = setInterval,
}) {
  const document = doc;
  function bindControls() {
    const room = getRoom();
    // Shared timer: controls just send commands; the readout is computed locally
    // from the synced anchor (state.timer), so it ticks smoothly with no per-second
    // patches. The interval also mirrors another client's changes into the controls.
    const timerReadout = byId('timerReadout'),
      timerToggle = byId('timerToggle');
    const timerMode = byId('timerMode'),
      timerDurRow = byId('timerDurRow'),
      timerDur = byId('timerDur');
    const durMs = () => (+timerDur.value || 0) * 60000;
    const modeVal = () => {
      const c = timerMode.querySelector('.libTab.on');
      return c ? c.dataset.mode : 'up';
    };
    const setMode = (m) =>
      timerMode
        .querySelectorAll('.libTab')
        .forEach((c) => c.classList.toggle('on', c.dataset.mode === m));
    // Timer open/close is handled by the top-right cluster (wireCluster below); its live value also shows in the button (see the tick loop).

    timerToggle.onclick = () =>
      room.send('timer', { action: room.state.timer.running ? 'pause' : 'start' });
    byId('timerReset').onclick = () => room.send('timer', { action: 'reset' });
    timerMode.querySelectorAll('.libTab').forEach(
      (c) =>
        (c.onclick = () => {
          setMode(c.dataset.mode);
          room.send('timer', { action: 'set', mode: c.dataset.mode, duration: durMs() });
        }),
    );
    timerDur.onchange = () =>
      room.send('timer', { action: 'set', mode: 'down', duration: durMs() });
    repeat(() => {
      const t = room.state.timer;
      const btnLbl = byId('timerBtn') && byId('timerBtn').querySelector('.lbl');
      if (btnLbl) btnLbl.textContent = t ? fmtTime(timerLive(t, now())) : '00:00';
      const mini = byId('timerMini'); // touch top bar (7e slice 2): the value only, and only while running
      if (mini) {
        mini.hidden = !(t && t.running);
        if (t && t.running) mini.textContent = fmtTime(timerLive(t, now()));
      }
      const r = byId('regionTR');
      const paneOpen = r && !r.hidden && r.querySelector('.pane[data-pane="timer"].on');
      if (!paneOpen || !t) return; // nothing more to draw unless the timer pane is showing
      timerReadout.textContent = fmtTime(timerLive(t, now()));
      setIcon(timerToggle, t.running ? 'player-pause' : 'player-play');
      if (modeVal() !== t.mode) setMode(t.mode); // reflect another client's switch
      timerDurRow.hidden = t.mode !== 'down';
      if (document.activeElement !== timerDur) timerDur.value = Math.round(t.duration / 60000); // don't fight typing
    }, 100);
  }
  return { bindControls };
}
