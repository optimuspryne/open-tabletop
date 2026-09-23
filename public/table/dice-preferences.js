import {
  DIE_SIDES,
  DICE_SETS,
  DICE_FINISHES,
  DICE_FINISH_FALLBACK,
  readableInk,
} from '../../shared/pieces.js';
// Per-device dice defaults and shared finish-picker data; live tray edits still use room messages.
export function createDicePreferences({
  byId,
  deviceClass,
  getRoom,
  getDieIds,
  onTextures,
  storage = localStorage,
}) {
  // My saved default color per die type — a LOCAL, per-device preference (like the lobby
  // accent), never synced. Shape in storage['ott-dice']: { "20": {color, textColor}, ... }
  // as ints. An absent type just means "no default" → the die spawns plain ivory/ink.
  function loadDiceDefaults() {
    try {
      return JSON.parse(storage.getItem('ott-dice') || '{}') || {};
    } catch {
      return {};
    }
  }
  function saveDiceDefault(sides, color, textColor, finish, finishImg) {
    const all = loadDiceDefaults();
    const d = { ...(all[String(sides)] || {}) }; // merge, so setting a finish doesn't wipe the color
    if (Number.isInteger(color)) d.color = color;
    if (Number.isInteger(textColor)) d.textColor = textColor;
    if (typeof finish === 'string') {
      if (finish === 'matte') {
        delete d.finish; // matte is the default look
        delete d.finishImg;
      } else if (finish === 'custom') {
        d.finish = 'custom';
        if (typeof finishImg === 'string') d.finishImg = finishImg; // the uploaded texture URL
      } else {
        d.finish = finish;
        delete d.finishImg; // a non-custom finish drops any stored texture
      }
    }
    all[String(sides)] = d;
    try {
      storage.setItem('ott-dice', JSON.stringify(all));
    } catch {}
  }
  // Spawn props for a die of this type, with my saved default color folded in (if any).
  function myDieProps(sides) {
    const p = { sides };
    const d = loadDiceDefaults()[String(sides)];
    if (d) {
      if (Number.isInteger(d.color)) p.color = d.color;
      if (Number.isInteger(d.textColor)) p.textColor = d.textColor;
      if (typeof d.finish === 'string') {
        p.finish = d.finish;
        if (d.finish === 'custom' && typeof d.finishImg === 'string') p.finishImg = d.finishImg;
      }
    }
    return p;
  }
  // Forget my saved default for one die type (back to plain ivory/ink on the next spawn).
  function clearDiceDefault(sides) {
    const all = loadDiceDefaults();
    delete all[String(sides)];
    try {
      storage.setItem('ott-dice', JSON.stringify(all));
    } catch {}
  }
  // Apply a dice set as my default across EVERY die type, and live-recolor the dice already in
  // my tray. Numbers are auto-contrasted from the body color. Local-only for the defaults; the
  // tray recolor goes through the normal (synced) recolor message so everyone sees it.
  function applyDiceSet(color) {
    const textColor = readableInk(color);
    for (const s of DIE_SIDES) saveDiceDefault(s, color, textColor);
    for (const id of getDieIds()) getRoom().send('recolor', { id, color, textColor });
  }

  // Apply a finish as my default across EVERY die type, and live-apply it to the dice already in my
  // tray (synced, so everyone sees them). Colors are untouched.
  function applyDiceFinish(finish, finishImg) {
    for (const s of DIE_SIDES) saveDiceDefault(s, undefined, undefined, finish, finishImg);
    const extra = finish === 'custom' ? { finish, finishImg } : { finish };
    for (const id of getDieIds()) getRoom().send('recolor', { id, ...extra });
  }

  // Custom dice textures (host-uploaded, ROADMAP §9 phase 2). The library list arrives via the
  // 'diceList' message; each becomes an image chip appended to a finish picker. Clicking one applies
  // the 'custom' finish with that texture URL. The inspection controller owns its own chips.
  let diceTextures = [];
  function buildTextureChips(row, apply) {
    if (!row) return;
    row.replaceChildren(); // dedicated texture row → just the thumbnails
    for (const t of diceTextures) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip texChip'; // thumbnail-only: the image IS the chip, name is the tooltip
      chip.dataset.tex = t.id;
      chip.title = t.name;
      chip.style.cssText =
        'width:34px;height:34px;padding:0;background-size:cover;background-position:center;border-radius:6px';
      chip.style.backgroundImage = `url("${t.url}")`;
      chip.onclick = () => apply(t.url);
      row.appendChild(chip);
    }
  }
  // Rebuild the Custom texture pickers and gate their menu buttons: no textures → no Custom button
  // in the dice box; the inspector's Custom button is also gated on the piece being a die (on inspect).
  function refreshTextureChips() {
    buildTextureChips(byId('trayTextures'), (url) => applyDiceFinish('custom', url));
    onTextures(diceTextures);
    const has = diceTextures.length > 0;
    const tg = byId('trayCustomGroup');
    if (tg) tg.hidden = !has;
    const dg = byId('dieCustomGroup');
    if (dg && !has) dg.hidden = true;
  }

  function bindControls() {
    {
      const setRow = byId('traySetSwatches'); // named dice sets: one click = a matching set for all my dice
      if (setRow)
        for (const s of DICE_SETS) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'swatch';
          chip.title = s.name + ' — set all my dice';
          chip.style.background = '#' + ((s.color >>> 0) & 0xffffff).toString(16).padStart(6, '0');
          chip.onclick = () => applyDiceSet(s.color); // saves defaults for every type + recolors my tray dice
          setRow.appendChild(chip);
        }
    }
    {
      const finRow = byId('trayFinishes'); // finishes: one click = that look for all my dice
      if (finRow) {
        for (const f of DICE_FINISHES) {
          if (f.key === 'custom') continue; // custom = the uploaded-texture chips appended below
          if (DICE_FINISH_FALLBACK[f.key] && deviceClass() === 'phone') continue; // GPU-heavy on phones
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.innerHTML = '<span class="lbl"></span>';
          chip.querySelector('.lbl').textContent = f.name;
          chip.title = f.name + ' — finish for all my dice';
          chip.onclick = () => applyDiceFinish(f.key);
          finRow.appendChild(chip);
        }
        refreshTextureChips(); // Custom textures live in their own #trayTextures menu
      }
    }
  }
  return {
    buildTextureChips,
    myDieProps,
    saveDiceDefault,
    clearDiceDefault,
    bindControls,
    setTextures(list) {
      diceTextures = list;
      refreshTextureChips();
    },
    syncTextures: refreshTextureChips,
  };
}
