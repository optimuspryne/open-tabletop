import { LIGHTING_PRESETS, normalizeLighting } from '../../shared/lighting.js';
import { BOARDS } from '../../shared/pieces.js';

// Own synchronized table/grid presentation, settings drafts and controls, and local quality UI.
// Rendering policy stays in core/graphics; shared geometry and message validation stay authoritative.
export function createRoomSettings({
  scene,
  gridMesh,
  gridLiftFallback,
  resizeTable,
  setTableColor,
  setRimWood,
  applyLighting,
  getQuality,
  setQuality,
  getRoom,
  onTableResize,
  syncWhiteboardSettings,
  relabelOverlays,
  byId,
  setIcon,
  doc = document,
  reload = () => location.reload(),
  alertUser = (message) => alert(message),
  confirmAction = (message) => confirm(message),
}) {
  const document = doc;
  const alert = alertUser;
  const confirm = confirmAction;
  let syncLightingPanel = () => {};
  // Preset colors for the felt + grid-line swatch popovers (the custom picker sits beside them).
  const FELT_COLORS = [
    '#2f6b4f',
    '#1e5c3f',
    '#2f4f6b',
    '#1e3a5c',
    '#6b2f3a',
    '#5c1e2a',
    '#3a3a3a',
    '#1a1a1a',
  ];
  const GRID_COLORS = ['#ffffff', '#888888', '#000000', '#e05555', '#55aaff', '#55cc77', '#e0c055'];
  const buildColorSwatches = (container, colors, apply) => {
    if (!container || container.childElementCount) return;
    colors.forEach((hex) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'swatch';
      chip.style.background = hex;
      chip.title = hex;
      chip.onclick = () => apply(hex);
      container.appendChild(chip);
    });
  };
  // The table grid (a flat LineSegments on the felt) or null when gridStyle is 'off'.
  // Rebuilt whenever the grid fields (cell size / style / colour) or the table size
  // change; reads everything from the synced room scale, so every seat draws the same.
  let gridLines = null;
  // The grid's height above the felt (GM-set, durable); falls back to the overlay lift.
  const gridY = () => {
    const room = getRoom();
    const v = room && +room.state.scale.gridLift;
    return Number.isFinite(v) ? v : gridLiftFallback;
  };
  // Reflect the current table shape in Customize Table: light the active chip, and for the
  // single-size shapes (round/hex) hide the depth field and relabel width as \"Size\".
  function syncTableShapeUI() {
    const room = getRoom();
    if (!room) return;
    const shape = room.state.tableShape || 'rect';
    document
      .querySelectorAll('#tableShapes [data-tshape]')
      .forEach((b) => b.classList.toggle('on', b.dataset.tshape === shape));
    const locked = shape === 'round' || shape === 'hex';
    const dl = byId('tableDLabel'),
      ds = byId('tableDimSep'),
      di = byId('tableD'),
      wl = byId('tableWLabel');
    const diWrap = (di && di.closest('.stepper')) || di; // hide the whole − / + stepper, not just the input
    if (dl) dl.hidden = locked;
    if (ds) ds.hidden = locked;
    if (diWrap) diWrap.hidden = locked;
    if (wl) wl.textContent = locked ? 'Size' : 'Width';
    document
      .querySelectorAll('#tableWoods [data-wood]')
      .forEach((b) =>
        b.classList.toggle('on', b.dataset.wood === (room.state.rimWood || 'mahogany')),
      );
  }

  function rebuildGrid() {
    const room = getRoom();
    if (gridLines) {
      scene.remove(gridLines);
      gridLines.geometry.dispose();
      gridLines.material.dispose();
      gridLines = null;
    }
    if (!room) return;
    const g = gridMesh(
      room.state.scale,
      room.state.tableX,
      room.state.tableZ,
      room.state.tableShape,
    );
    if (g) {
      g.position.y = gridY();
      scene.add(g);
      gridLines = g;
    }
  }

  function syncScalePanel() {
    const room = getRoom();
    const sc = room.state.scale;
    if (!sc) return;
    const u = sc.unitLabel || 'u';
    const custom = u !== 'u' && !['in', 'cm', 'mm'].includes(u); // a user-typed label like "hex"
    // Light the matching toggle (or Custom…); reveal the custom field only when custom.
    document
      .querySelectorAll('#scaleUnits [data-unit]')
      .forEach((b) =>
        b.classList.toggle(
          'on',
          b.dataset.unit === u || (custom && b.dataset.unit === '__custom__'),
        ),
      );
    const cRow = byId('scaleCustomRow');
    if (cRow) cRow.hidden = !custom;
    const cInp = byId('scaleUnitCustom');
    if (cInp && document.activeElement !== cInp) cInp.value = custom ? u : '';
    const sEl = byId('scaleStep');
    // roundStep arrives as a float32 from the schema (0.1 → 0.10000000149…), which
    // overflowed the field. Show it at the precision anyone would type.
    if (sEl && document.activeElement !== sEl) sEl.value = String(+(+sc.roundStep).toFixed(4));
    const su = byId('scaleStepUnit');
    if (su) su.textContent = u;
    const wu = byId('scaleWidthUnit');
    if (wu) wu.textContent = u;
    const wv = byId('scaleWidthVal'); // prefill with the table's CURRENT width in display units (editable)
    if (wv && document.activeElement !== wv) {
      const cur = (room.state.tableX * 2) / (+sc.worldPerUnit || 1);
      wv.value = Number.isFinite(cur) ? String(+cur.toFixed(2)) : '';
    }
    // Grid controls: light the active style, reveal cell/color rows when a grid is on,
    // show the cell size in display units, and mirror the line color.
    const gStyle = sc.gridStyle || 'off',
      gridOn = gStyle !== 'off',
      isHex = gStyle === 'hex';
    document
      .querySelectorAll('#gridStyles [data-grid]')
      .forEach((b) => b.classList.toggle('on', b.dataset.grid === gStyle));
    const gorow = byId('gridOrientRow');
    if (gorow) gorow.hidden = !isHex; // orientation (pointy/flat) is hex-only
    const orient = sc.hexOrient === 'flat' ? 'flat' : 'pointy';
    document
      .querySelectorAll('#gridOrients [data-orient]')
      .forEach((b) => b.classList.toggle('on', b.dataset.orient === orient));
    const gclbl = byId('gridCellLabel');
    if (gclbl) gclbl.textContent = isHex ? 'Hex size' : 'Cell size';
    const gczSep = byId('gridCellZSep');
    if (gczSep) gczSep.hidden = isHex; // hex is a single size — no separate depth
    const gczIn = byId('gridCellZ');
    const gczWrap = (gczIn && gczIn.closest('.stepper')) || gczIn; // hide the whole stepper, not just the input
    if (gczWrap) gczWrap.hidden = isHex;
    const gcr = byId('gridCellRow');
    if (gcr) gcr.hidden = !gridOn;
    const gor = byId('gridOffRow');
    if (gor) gor.hidden = !gridOn;
    const gou = byId('gridOffUnit');
    if (gou) gou.textContent = u;
    const gcalr = byId('gridCalibRow');
    if (gcalr) gcalr.hidden = !gridOn;
    const gkr = byId('gridColorRow');
    if (gkr) gkr.hidden = !gridOn;
    const glr = byId('gridLiftRow');
    if (glr) glr.hidden = !gridOn;
    const gl = byId('gridLift');
    if (gl && document.activeElement !== gl)
      gl.value = Number.isFinite(+sc.gridLift) ? sc.gridLift : 0.05;
    const gcu = byId('gridCellUnit');
    if (gcu) gcu.textContent = u;
    const perU = +sc.worldPerUnit || 1;
    const gc = byId('gridCell');
    if (gc && document.activeElement !== gc) {
      const wc = (+sc.cellWorld || 0) / perU;
      gc.value = wc > 0 ? String(+wc.toFixed(3)) : '';
    }
    const gcz = byId('gridCellZ'); // cell DEPTH (Z spacing); falls back to the width for a square grid
    if (gcz && document.activeElement !== gcz) {
      const dc = ((+sc.cellZ > 0 ? +sc.cellZ : +sc.cellWorld) || 0) / perU;
      gcz.value = dc > 0 ? String(+dc.toFixed(3)) : '';
    }
    const gox = byId('gridOffX');
    if (gox && document.activeElement !== gox)
      gox.value = String(+((+sc.gridX || 0) / perU).toFixed(3));
    const goz = byId('gridOffZ');
    if (goz && document.activeElement !== goz)
      goz.value = String(+((+sc.gridZ || 0) / perU).toFixed(3));
    const gk = byId('gridColor');
    if (gk && document.activeElement !== gk && /^#[0-9a-f]{6}$/i.test(sc.gridColor || ''))
      gk.value = sc.gridColor;
    const gsr = byId('gridSnapRow');
    if (gsr) gsr.hidden = !gridOn || isHex; // snap anchor (centres vs crossings); hex is centres-only
    const ghr = byId('gridHideRow');
    if (ghr) ghr.hidden = !gridOn; // hide-grid toggle (snaps, not drawn)
    const ght = byId('gridHideTog');
    if (ght) {
      ght.classList.toggle('on', !!sc.gridHidden);
      setIcon(ght, sc.gridHidden ? 'eye-off' : 'eye');
    }
    const anchor = sc.snapAnchor === 'cross' ? 'cross' : 'center';
    document
      .querySelectorAll('#gridAnchors [data-anchor]')
      .forEach((b) => b.classList.toggle('on', b.dataset.anchor === anchor));
    relabelOverlays(); // scale drives every ruler's label
  }
  function bindRoom(room, cb) {
    cb(room.state).listen(
      'tableX',
      () => {
        resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
        onTableResize();
        rebuildGrid();
      },
      false,
    );
    cb(room.state).listen(
      'tableZ',
      () => {
        resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
        onTableResize();
        rebuildGrid();
      },
      false,
    );
    cb(room.state).listen(
      'tableShape',
      () => {
        resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
        rebuildGrid();
        syncTableShapeUI();
      },
      false,
    );
    cb(room.state).listen(
      'rimWood',
      () => {
        setRimWood(room.state.rimWood);
        syncTableShapeUI();
      },
      false,
    );
    cb(room.state).listen('feltColor', () => setTableColor(room.state.feltColor), false);
    const onLighting = () => {
      applyLighting(room.state.lighting);
      syncLightingPanel();
    };
    for (const field of [
      'preset',
      'azimuth',
      'elevation',
      'keyIntensity',
      'keyColor',
      'ambientIntensity',
      'ambientColor',
      'shadowSoftness',
    ])
      cb(room.state).lighting.listen(field, onLighting, false);
    cb(room.state).scale.listen('worldPerUnit', syncScalePanel, false);
    cb(room.state).scale.listen('unitLabel', syncScalePanel, false);
    cb(room.state).scale.listen('roundStep', syncScalePanel, false);
    const onGrid = () => {
      rebuildGrid();
      syncScalePanel();
    }; // redraw + reflect the panel
    cb(room.state).scale.listen('cellWorld', onGrid, false); // grid: cell width (X)
    cb(room.state).scale.listen('cellZ', onGrid, false); // grid: cell depth (Z) — rectangular grids
    cb(room.state).scale.listen('gridX', onGrid, false); // grid: lattice offset X
    cb(room.state).scale.listen('gridZ', onGrid, false); // grid: lattice offset Z
    cb(room.state).scale.listen('gridStyle', onGrid, false); // grid: off / square / hex
    cb(room.state).scale.listen('hexOrient', onGrid, false); // hex: pointy / flat orientation
    cb(room.state).scale.listen('gridHidden', onGrid, false); // grid: shown / hidden (still snaps)
    cb(room.state).scale.listen('gridColor', onGrid, false); // grid: line colour
    cb(room.state).scale.listen(
      'gridLift',
      () => {
        if (gridLines) gridLines.position.y = gridY();
        syncScalePanel();
      },
      false,
    ); // height: just move it, no rebuild
    cb(room.state).scale.listen('snapAnchor', syncScalePanel, false); // snap target only — no redraw
  }
  function hydrate() {
    const room = getRoom();
    if (room.state.tableX) {
      resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
      onTableResize();
    } // initial size (may be default until decode)
    if (room.state.feltColor) setTableColor(room.state.feltColor); // initial felt color
    if (room.state.lighting) applyLighting(room.state.lighting, { duration: 0 });
    setRimWood(room.state.rimWood || 'mahogany'); // initial rim wood
    rebuildGrid(); // initial grid (inert until a GM sets a cell size + square style)
  }
  function bindControls() {
    const room = getRoom();
    const wire = (id, fn) => {
      const el = byId(id);
      if (el) el.onclick = fn;
    };
    // Room Settings modal (UI_Redesign phase 3): tabbed Table Size & Color + Scale & Grid (Whiteboard + Skybox join in 3b).
    {
      const rs = byId('roomSettingsModal');
      let lightingDraft = null;
      let lightingEditing = false;
      const lightingFields = {
        azimuth: byId('lightingAzimuth'),
        elevation: byId('lightingElevation'),
        keyIntensity: byId('lightingKeyIntensity'),
        keyColor: byId('lightingKeyColor'),
        ambientIntensity: byId('lightingAmbientIntensity'),
        ambientColor: byId('lightingAmbientColor'),
        shadowSoftness: byId('lightingShadowSoftness'),
      };
      const lightingValue = () => normalizeLighting(room.state.lighting);
      const renderLightingGlobe = () => {
        if (!lightingDraft) return;
        const globe = byId('lightingGlobe');
        const az = (lightingDraft.azimuth * Math.PI) / 180;
        const el = (lightingDraft.elevation * Math.PI) / 180;
        const x = 50 + Math.sin(az) * Math.cos(el) * 42;
        const y = 50 - Math.sin(el) * 42;
        globe?.style.setProperty('--light-x', `${x}%`);
        globe?.style.setProperty('--light-y', `${y}%`);
        globe?.style.setProperty('--sun-x', `${x}%`);
        globe?.style.setProperty('--sun-y', `${y}%`);
        globe?.style.setProperty('--key-color', lightingDraft.keyColor);
        globe?.style.setProperty('--ambient-color', lightingDraft.ambientColor);
        globe?.style.setProperty(
          '--globe-brightness',
          String(0.35 + lightingDraft.ambientIntensity * 0.35 + lightingDraft.keyIntensity * 0.3),
        );
        globe?.style.setProperty('--shadow-angle', `${lightingDraft.azimuth + 180}deg`);
        globe?.style.setProperty('--shadow-blur', `${1 + lightingDraft.shadowSoftness * 8}px`);
        globe?.style.setProperty(
          '--shadow-opacity',
          String(
            Math.min(0.85, lightingDraft.keyIntensity * (1 - lightingDraft.ambientIntensity * 0.5)),
          ),
        );
        globe?.setAttribute('aria-valuenow', String(Math.round(lightingDraft.azimuth)));
        globe?.setAttribute(
          'aria-valuetext',
          `${Math.round(lightingDraft.azimuth)} degree heading, ${Math.round(lightingDraft.elevation)} degree elevation`,
        );
      };
      const renderLightingControls = () => {
        if (!lightingDraft || !byId('lightingPreset')) return;
        byId('lightingPreset').value = lightingDraft.preset;
        for (const [key, input] of Object.entries(lightingFields))
          if (input) input.value = lightingDraft[key];
        byId('lightingKeyOut').textContent = `${Math.round(lightingDraft.keyIntensity * 100)}%`;
        byId('lightingAmbientOut').textContent =
          `${Math.round(lightingDraft.ambientIntensity * 100)}%`;
        byId('lightingShadowOut').textContent =
          lightingDraft.shadowSoftness < 0.34
            ? 'Hard'
            : lightingDraft.shadowSoftness < 0.67
              ? 'Medium'
              : 'Soft';
        renderLightingGlobe();
      };
      const previewLighting = (custom = true) => {
        if (!lightingDraft) return;
        if (custom) lightingDraft.preset = 'custom';
        lightingDraft = normalizeLighting(lightingDraft);
        renderLightingControls();
        applyLighting(lightingDraft, { duration: 0 });
      };
      syncLightingPanel = () => {
        if (lightingEditing) return;
        lightingDraft = lightingValue();
        const isOwner = room.state.players.get(room.sessionId)?.role === 'owner';
        if (byId('lightingSaveDefault')) byId('lightingSaveDefault').hidden = !isOwner;
        if (byId('lightingFactory')) byId('lightingFactory').hidden = !isOwner;
        renderLightingControls();
      };
      const syncRoomSettings = () => {
        byId('tableW').value = Math.round(room.state.tableX * 2);
        byId('tableD').value = Math.round(room.state.tableZ * 2);
        syncTableShapeUI();
        byId('tableFelt').value = room.state.feltColor || '#2f6b4f';
        syncScalePanel();
        syncWhiteboardSettings(room.state.whiteboard);
        lightingEditing = false;
        syncLightingPanel();
      };
      wire('roomSettings', () => {
        byId('roomGrp').hidden = true;
        if (rs) {
          rs.hidden = false;
          syncRoomSettings();
        }
      });
      wire('roomSettingsClose', () => {
        if (rs) {
          if (lightingEditing) applyLighting(lightingValue(), { duration: 0 });
          lightingEditing = false;
          rs.hidden = true;
        }
      });
      rs?.querySelectorAll('.libTab').forEach(
        (t) =>
          (t.onclick = () => {
            rs.querySelectorAll('.libTab').forEach((x) => x.classList.toggle('on', x === t));
            rs.querySelectorAll('.libPane').forEach((p) => {
              p.hidden = p.dataset.pane !== t.dataset.tab;
            });
          }),
      );

      const preset = byId('lightingPreset');
      if (preset)
        preset.onchange = () => {
          if (preset.value === 'custom') {
            lightingDraft.preset = 'custom';
            lightingEditing = true;
            return previewLighting(false);
          }
          if (!LIGHTING_PRESETS[preset.value]) return;
          lightingDraft = { preset: preset.value, ...LIGHTING_PRESETS[preset.value] };
          lightingEditing = true;
          previewLighting(false);
        };
      for (const [key, input] of Object.entries(lightingFields)) {
        if (!input) continue;
        input.oninput = () => {
          lightingEditing = true;
          lightingDraft[key] = input.type === 'color' ? input.value : +input.value;
          previewLighting();
        };
      }
      const globe = byId('lightingGlobe');
      if (globe) {
        let drag = null;
        globe.onpointerdown = (event) => {
          drag = {
            x: event.clientX,
            y: event.clientY,
            azimuth: lightingDraft.azimuth,
            elevation: lightingDraft.elevation,
          };
          globe.setPointerCapture(event.pointerId);
        };
        globe.onpointermove = (event) => {
          if (!drag) return;
          lightingEditing = true;
          lightingDraft.azimuth = (drag.azimuth + (event.clientX - drag.x) * 1.5 + 360) % 360;
          lightingDraft.elevation = Math.max(
            10,
            Math.min(90, drag.elevation - (event.clientY - drag.y) * 0.65),
          );
          previewLighting();
        };
        globe.onpointerup = globe.onpointercancel = () => (drag = null);
        globe.onkeydown = (event) => {
          const fine = event.shiftKey ? 1 : 5;
          if (event.key === 'ArrowLeft') lightingDraft.azimuth -= fine;
          else if (event.key === 'ArrowRight') lightingDraft.azimuth += fine;
          else if (event.key === 'ArrowUp') lightingDraft.elevation += fine;
          else if (event.key === 'ArrowDown') lightingDraft.elevation -= fine;
          else return;
          event.preventDefault();
          lightingEditing = true;
          lightingDraft.azimuth = (lightingDraft.azimuth + 360) % 360;
          lightingDraft.elevation = Math.max(10, Math.min(90, lightingDraft.elevation));
          previewLighting();
        };
        globe.ondblclick = () => {
          const name = LIGHTING_PRESETS[lightingDraft.preset] ? lightingDraft.preset : 'neutral';
          lightingDraft = { preset: name, ...LIGHTING_PRESETS[name] };
          lightingEditing = true;
          previewLighting(false);
        };
      }
      wire('lightingApply', () => {
        room.send('lightingApply', normalizeLighting(lightingDraft));
        lightingEditing = false;
        if (rs) rs.hidden = true;
      });
      wire('lightingCancel', () => {
        lightingEditing = false;
        applyLighting(lightingValue(), { duration: 0 });
        if (rs) rs.hidden = true;
      });
      wire('lightingRestore', () => {
        lightingEditing = false;
        room.send('lightingRestore');
      });
      wire('lightingSaveDefault', () => {
        const lighting = normalizeLighting(lightingDraft);
        lightingEditing = false;
        room.send('lightingDefaultSave', lighting);
      });
      wire('lightingFactory', () => {
        if (confirm('Reset the room default and current lighting to the factory setup?')) {
          lightingEditing = false;
          room.send('lightingFactoryReset');
        }
      });
    }
    // Live table resize: each ± (or a typed change) on width/depth applies immediately.
    {
      const send = () => {
        const shape = room.state.tableShape || 'rect';
        const x = (+byId('tableW').value || 20) / 2;
        const z = shape === 'round' || shape === 'hex' ? x : (+byId('tableD').value || 14) / 2;
        room.send('table', { x, z });
      };
      const w = byId('tableW'),
        d = byId('tableD');
      if (w) w.onchange = send;
      if (d) d.onchange = send;
      // Shape picker: rect/round/oval/hex/roundedRect. round + hex are single-size (send z = x).
      document.querySelectorAll('#tableShapes [data-tshape]').forEach((b) => {
        b.onclick = () => {
          const shape = b.dataset.tshape;
          const msg = { shape };
          if (shape === 'round' || shape === 'hex') {
            msg.x = room.state.tableX;
            msg.z = room.state.tableX; // depth follows width for round/hex
          }
          room.send('table', msg);
        };
      });
      // Rim wood picker (GM-set, durable): swap the wooden border texture.
      document.querySelectorAll('#tableWoods [data-wood]').forEach((b) => {
        b.onclick = () => room.send('table', { rimWood: b.dataset.wood });
      });
      const felt = byId('tableFelt');
      if (felt) felt.oninput = () => room.send('tableColor', { color: felt.value });
      buildColorSwatches(byId('feltSwatches'), FELT_COLORS, (hex) => {
        const f = byId('tableFelt');
        if (f) f.value = hex;
        room.send('tableColor', { color: hex });
      });
    }

    // Measurement scale (GM-set, durable). Reads live from room.state.scale; writes
    // via scaleSet. Drag-calibration lands with the ruler tool (Step 3).
    {
      const sEl = byId('scaleStep');
      if (sEl)
        sEl.onchange = () => {
          const v = +sEl.value;
          if (v > 0) room.send('scaleSet', { roundStep: v });
        };
      const cRow = byId('scaleCustomRow'),
        cInp = byId('scaleUnitCustom');
      // Unit toggles: inch/cm/mm set the label + a sensible round step; "Custom…" reveals
      // a text field for a free-form label (e.g. "hex"). Mirrors the Measure kind picker.
      document.querySelectorAll('#scaleUnits [data-unit]').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.unit === '__custom__') {
            document
              .querySelectorAll('#scaleUnits [data-unit]')
              .forEach((x) => x.classList.toggle('on', x === b));
            if (cRow) cRow.hidden = false;
            if (cInp) {
              cInp.focus();
              cInp.select();
            }
          } else {
            room.send('scaleSet', { unitLabel: b.dataset.unit, roundStep: +b.dataset.step || 0.5 });
          }
        };
      });
      const sendCustom = () => {
        const v = (cInp.value || '').trim().slice(0, 8);
        if (v) room.send('scaleSet', { unitLabel: v });
      };
      if (cInp) {
        cInp.onchange = sendCustom;
        cInp.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            sendCustom();
            cInp.blur();
          }
        };
      }
      // Calibrate from the typed real width: worldPerUnit = tableWorldWidth / N.
      const setW = byId('scaleWidthSet');
      if (setW)
        setW.onclick = () => {
          const n = parseFloat(byId('scaleWidthVal').value);
          if (n > 0) room.send('scaleSet', { worldPerUnit: (room.state.tableX * 2) / n });
        };
      const wv = byId('scaleWidthVal');
      if (wv)
        wv.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setW && setW.onclick();
          }
        };
      // Grid: style toggle (Off/Square), cell size (display units → world), line color.
      document.querySelectorAll('#gridStyles [data-grid]').forEach((b) => {
        b.onclick = () => {
          const msg = { gridStyle: b.dataset.grid };
          // Enabling a grid for the first time needs a cell size, or it renders nothing:
          // default to one display unit per cell.
          if (b.dataset.grid !== 'off' && !(+room.state.scale.cellWorld > 0))
            msg.cellWorld = +room.state.scale.worldPerUnit || 1;
          room.send('scaleSet', msg);
        };
      });
      // Cell size — width (X) and depth (Z) independently, so a rectangular board (go) can be
      // matched. Equal values = a square grid.
      const gc = byId('gridCell');
      if (gc)
        gc.onchange = () => {
          const v = +gc.value;
          if (v > 0)
            room.send('scaleSet', { cellWorld: v * (+room.state.scale.worldPerUnit || 1) });
        };
      const gcz = byId('gridCellZ');
      if (gcz)
        gcz.onchange = () => {
          const v = +gcz.value;
          if (v > 0) room.send('scaleSet', { cellZ: v * (+room.state.scale.worldPerUnit || 1) });
        };
      // Offset — nudge the grid lattice to line up with a printed map's phase (X, Z).
      const gox = byId('gridOffX');
      if (gox)
        gox.onchange = () =>
          room.send('scaleSet', {
            gridX: (+gox.value || 0) * (+room.state.scale.worldPerUnit || 1),
          });
      const goz = byId('gridOffZ');
      if (goz)
        goz.onchange = () =>
          room.send('scaleSet', {
            gridZ: (+goz.value || 0) * (+room.state.scale.worldPerUnit || 1),
          });
      const gk = byId('gridColor');
      if (gk) gk.oninput = () => room.send('scaleSet', { gridColor: gk.value });
      buildColorSwatches(byId('gridColorSwatches'), GRID_COLORS, (hex) => {
        const g = byId('gridColor');
        if (g) g.value = hex;
        room.send('scaleSet', { gridColor: hex });
      });
      const gl = byId('gridLift');
      if (gl) gl.oninput = () => room.send('scaleSet', { gridLift: +gl.value });
      // Snap anchor: cell centres (chess/checkers) vs line crossings (go). Also tells the
      // "Fit to board" button whether the count you enter means squares or lines.
      document.querySelectorAll('#gridAnchors [data-anchor]').forEach((b) => {
        b.onclick = () => room.send('scaleSet', { snapAnchor: b.dataset.anchor });
      });
      // Hex orientation: pointy-top vs flat-top (hex grids only).
      document.querySelectorAll('#gridOrients [data-orient]').forEach((b) => {
        b.onclick = () => room.send('scaleSet', { hexOrient: b.dataset.orient });
      });
      {
        const b = byId('gridHideTog');
        if (b)
          b.onclick = () => room.send('scaleSet', { gridHidden: !room.state.scale.gridHidden });
      } // hide the lines, keep snapping
      // Fit to board: size the grid to the board on the table. Built-in boards need nothing (the
      // registry knows their geometry — one click); a custom/image board takes the count you type
      // in the "across" field, read as squares or lines per the current Snap-to setting.
      const calibBtn = byId('gridCalib');
      if (calibBtn)
        calibBtn.onclick = () => {
          let boardPiece = null;
          room.state.pieces.forEach((p) => {
            if (!boardPiece && p.type === 'board') boardPiece = p;
          });
          if (!boardPiece) {
            alert('Place a board on the table first, then fit the grid to it.');
            return;
          }
          const spec = BOARDS[JSON.parse(boardPiece.props || '{}').board];
          const n = parseInt(byId('gridCells').value, 10);
          if (room.state.scale.gridStyle === 'hex') {
            if (n > 0) room.send('calibrateGrid', { cells: n });
            else alert('Enter how many hexes go across the board.');
            return;
          }
          const anchor = room.state.scale.snapAnchor === 'cross' ? 'cross' : 'center';
          if (n > 0) room.send('calibrateGrid', { cells: n, anchor });
          else if (spec && spec.grid)
            room.send('calibrateGrid', {}); // built-in: use its known cell count
          else alert('Enter how many cells (or lines, for a go-style board) go across the board.');
        };
    }

    // Graphics quality (Settings → UI): a client-local render tier, persisted on this device.
    // Picking a tier persists it and live-applies pixel ratio + shadows; antialias (and, on iOS
    // Safari, the pixel-ratio change) only take full effect on reload, so an Apply button appears
    // once the selection differs from the tier the page booted with.
    {
      const qrow = byId('qualityRow');
      const applyBtn = byId('qualityApply');
      if (qrow) {
        const bootedTier = getQuality();
        const chips = [...qrow.querySelectorAll('[data-quality]')];
        const sync = () => {
          chips.forEach((c) => c.classList.toggle('on', c.dataset.quality === getQuality()));
          if (applyBtn) applyBtn.hidden = getQuality() === bootedTier;
        };
        chips.forEach(
          (c) =>
            (c.onclick = () => {
              setQuality(c.dataset.quality);
              sync();
            }),
        );
        if (applyBtn) applyBtn.onclick = () => reload();
        sync();
      }
    }
  }
  return { bindRoom, hydrate, bindControls };
}
