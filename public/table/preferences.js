import {
  setSfxVolume,
  getSfxVolume,
  setSfxMuted,
  getSfxMuted,
  setMusicMuted,
  getMusicMuted,
  toggleMusic,
  nextTrack,
  playTrack,
  currentTrackIndex,
  getShuffle,
  setShuffle,
  setMusicVolume,
  getMusicVolume,
  isMusicPlaying,
  onMusicTrack,
} from '../audio.js';
import {
  MUSIC,
  MUSIC_CREDIT,
  SFX_CREDITS,
  MODEL_CREDITS,
  ART_CREDITS,
  LIB_CREDITS,
} from '../credits.js';
// Personal audio/theme preferences and their settings/help/attribution panels.
export function bindPreferences({ byId, setIcon }) {
  // Escape a string for safe interpolation into an innerHTML fragment.
  const escapeHtml = (x) =>
    String(x).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const wire = (id, fn) => {
    const el = byId(id);
    if (el) el.onclick = fn;
  };
  // Audio settings (Tools menu): effects volume + mute, persisted client-side.
  const sfxVol = byId('sfxVol');
  {
    // Music open/close is handled by the top-right cluster (audioBtn → music pane; table-shell.js).
    // The audio keeps playing when the pane is closed — only the controls hide.
    if (sfxVol) {
      sfxVol.value = Math.round(getSfxVolume() * 100);
      sfxVol.oninput = () => setSfxVolume(sfxVol.value / 100);
    }
    const muteBtn = (btn, get, set, on, off) => {
      if (!btn) return;
      const sync = () => setIcon(btn, get() ? off : on);
      sync();
      btn.onclick = () => {
        set(!get());
        sync();
      };
    };
    muteBtn(byId('sfxMute'), getSfxMuted, setSfxMuted, 'ear', 'ear-off');
    muteBtn(byId('musicMute'), getMusicMuted, setMusicMuted, 'music', 'music-off');
    // background music
    const musicVol = byId('musicVol'),
      musicToggle = byId('musicToggle'),
      nowPlaying = byId('nowPlaying');
    if (musicVol) {
      musicVol.value = Math.round(getMusicVolume() * 100);
      musicVol.oninput = () => setMusicVolume(musicVol.value / 100);
    }
    const syncMusicBtn = () => {
      if (musicToggle) setIcon(musicToggle, isMusicPlaying() ? 'player-pause' : 'player-play');
    };
    if (musicToggle)
      musicToggle.onclick = () => {
        toggleMusic();
        syncMusicBtn();
      };
    wire('musicNext', () => {
      nextTrack();
      syncMusicBtn();
    });
    const shuffleBtn = byId('musicShuffle');
    if (shuffleBtn) {
      shuffleBtn.classList.toggle('on', getShuffle());
      shuffleBtn.onclick = () => {
        const on = !getShuffle();
        setShuffle(on);
        shuffleBtn.classList.toggle('on', on);
      };
    }
    onMusicTrack((t) => {
      if (nowPlaying)
        nowPlaying.textContent = t
          ? '\u266a ' + t.title + ' \u2014 ' + MUSIC_CREDIT.by + ' (' + MUSIC_CREDIT.license + ')'
          : '';
    });
    // credits panel — attribution for baked-in assets (CC-BY music requires this)
    const renderCredits = () => {
      const body = byId('creditsBody');
      if (!body) return;
      const esc = escapeHtml;
      const A = (t, u) =>
        u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>' : esc(t);
      const ul = 'style="margin:4px 0 10px;padding-left:18px;font-size:var(--fs-sm)"';
      let h = '';
      if (MUSIC.length) {
        h += '<div class="showLabel"><b>Music</b></div><ul ' + ul + '>';
        for (const t of MUSIC)
          h +=
            '<li>' +
            esc(t.title) +
            ' \u2014 ' +
            A(MUSIC_CREDIT.by, MUSIC_CREDIT.url) +
            ', ' +
            A(MUSIC_CREDIT.license, MUSIC_CREDIT.licenseUrl) +
            '</li>';
        h += '</ul>';
      }
      h += '<div class="showLabel"><b>Sound effects</b></div><ul ' + ul + '>';
      for (const x of SFX_CREDITS)
        h += '<li>' + esc(x.title) + ' \u2014 ' + A(x.by, x.url) + ', ' + esc(x.license) + '</li>';
      h += '</ul>';
      h += '<div class="showLabel"><b>Models</b></div><ul ' + ul + '>';
      for (const x of MODEL_CREDITS)
        h +=
          '<li>' +
          esc(x.title) +
          ' \u2014 ' +
          A(x.by, x.url) +
          ', ' +
          esc(x.license) +
          (x.note ? ' \u2014 ' + esc(x.note) : '') +
          '</li>';
      h += '</ul>';
      h += '<div class="showLabel"><b>Art</b></div><ul ' + ul + '>';
      for (const x of ART_CREDITS)
        h +=
          '<li>' +
          esc(x.title) +
          ' \u2014 ' +
          A(x.by, x.url) +
          ', ' +
          esc(x.license) +
          (x.note ? ' \u2014 ' + esc(x.note) : '') +
          '</li>';
      h += '</ul>';
      h += '<div class="showLabel"><b>Libraries</b></div><ul ' + ul + '>';
      for (const l of LIB_CREDITS)
        h += '<li>' + A(l.title, l.url) + ' \u2014 ' + esc(l.license) + '</li>';
      h += '</ul>';
      body.innerHTML = h;
    };
    // Settings modal (reuses renderCredits above for the Credits section)
    const settingsModal = byId('settingsModal');
    wire('settingsBtn', () => {
      if (settingsModal) {
        settingsModal.hidden = false;
        renderCredits();
      }
    });
    wire('settingsClose', () => {
      if (settingsModal) settingsModal.hidden = true;
    });
    settingsModal?.querySelectorAll('.libTab').forEach(
      (t) =>
        (t.onclick = () => {
          settingsModal
            .querySelectorAll('.libTab')
            .forEach((x) => x.classList.toggle('on', x === t));
          settingsModal.querySelectorAll('.libPane').forEach((p) => {
            p.hidden = p.dataset.pane !== t.dataset.tab;
          });
        }),
    );
    // How-to-Play tabs (Mouse & Keyboard / Touch / Table & Tools / Coming Soon).
    const helpModal = byId('controlsModal');
    helpModal?.querySelectorAll('.libTab').forEach(
      (t) =>
        (t.onclick = () => {
          helpModal.querySelectorAll('.libTab').forEach((x) => x.classList.toggle('on', x === t));
          helpModal.querySelectorAll('.libPane').forEach((p) => {
            p.hidden = p.dataset.pane !== t.dataset.tab;
          });
        }),
    );

    // Full / Compact UI toggle (persisted)
    const uiModeToggle = byId('uiModeToggle');
    const syncUiMode = () => {
      const full = document.body.classList.contains('ui-full');
      if (uiModeToggle) {
        const mode = full ? 'Default UI' : 'Compact UI';
        setIcon(uiModeToggle, full ? 'arrows-minimize' : 'arrows-maximize');
        uiModeToggle.classList.toggle('on', full);
        uiModeToggle.setAttribute('aria-pressed', full ? 'true' : 'false');
        uiModeToggle.setAttribute('aria-label', mode);
        const l = uiModeToggle.querySelector('.lbl');
        if (l) l.textContent = mode;
      }
    };
    syncUiMode();
    wire('uiModeToggle', () => {
      const full = document.body.classList.toggle('ui-full');
      localStorage.setItem('ott-ui-full', full ? '1' : '0');
      syncUiMode();
    });
    // Accent color (personal, saved on this device)
    const applyAccent = (hex) => {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
      const st = document.documentElement.style;
      st.setProperty('--accent', hex);
      st.setProperty(
        '--accent-soft',
        'rgba(' +
          parseInt(hex.slice(1, 3), 16) +
          ',' +
          parseInt(hex.slice(3, 5), 16) +
          ',' +
          parseInt(hex.slice(5, 7), 16) +
          ',.25)',
      );
      localStorage.setItem('ott-accent', hex);
      document
        .querySelectorAll('#accentPicker .accDot')
        .forEach((d) =>
          d.classList.toggle('on', d.dataset.accent.toLowerCase() === hex.toLowerCase()),
        );
      const c = byId('accentCustom');
      if (c) c.value = hex;
    };
    document
      .querySelectorAll('#accentPicker .accDot')
      .forEach((d) => (d.onclick = () => applyAccent(d.dataset.accent)));
    const accCust = byId('accentCustom');
    if (accCust) accCust.oninput = () => applyAccent(accCust.value);
    applyAccent(localStorage.getItem('ott-accent') || '#c9a25a');
    // Track list (7i): inline inside the Sound pane now — the pop-out is gone,
    // so #tracksLink just discloses #tracksBody in place.
    const renderTracks = () => {
      const body = byId('tracksBody');
      if (!body) return;
      if (!MUSIC.length) {
        body.innerHTML = '<div class="muted">No tracks added yet.</div>';
        return;
      }
      const esc = escapeHtml;
      const cur = currentTrackIndex();
      body.innerHTML = MUSIC.map(
        (t, i) => '<button class="trackItem" data-i="' + i + '">' + esc(t.title) + '</button>',
      ).join('');
      body.querySelectorAll('.trackItem').forEach((btn) => {
        btn.classList.toggle('on', +btn.dataset.i === cur);
        btn.onclick = () => {
          playTrack(+btn.dataset.i);
          syncMusicBtn();
          renderTracks();
        };
      });
    };
    wire('tracksLink', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const body = byId('tracksBody');
      if (!body) return;
      const open = body.hidden;
      if (open) renderTracks();
      body.hidden = !open;
      byId('tracksLink')?.classList.toggle('on', open);
    });
  }
}
