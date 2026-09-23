// Asset response routing; authoring and pickers remain in editor-panel.js.
export function bindLibraryMessages(
  room,
  {
    onDiceTextures,
    byId,
    setIcon,
    setBtnLabel,
    win = window,
    alertUser = alert,
    now = Date.now,
    delay = setTimeout,
    cancelDelay = clearTimeout,
  },
) {
  const window = win;
  const alert = alertUser;
  room.onMessage('diceList', (list) => {
    const diceTextures = Array.isArray(list) ? list : [];
    onDiceTextures(diceTextures);
    if (window.onLibraryList) window.onLibraryList('dice', diceTextures); // editor library list
  });
  room.send('listDice'); // load the finish pickers' custom-texture chips (also refreshed on saves)
  room.onMessage('skyList', (list) => {
    if (window.onLibraryList) window.onLibraryList('sky', list || []);
  }); // fans to the library + skybox picker
  room.onMessage('skyError', ({ message } = {}) => {
    const e = byId('skyErr');
    if (e) e.textContent = message || 'Could not add that skybox.';
  });
  let lastAssetErrorAt = 0;
  room.onMessage('assetError', ({ message } = {}) => {
    const time = now();
    if (time - lastAssetErrorAt < 5000) return; // one refresh requests every asset kind; report one outage, not five alerts
    lastAssetErrorAt = time;
    alert(message || 'The library is temporarily unavailable.');
  });
  room.onMessage('deckList', (decks) => {
    if (window.onLibraryList) window.onLibraryList('deck', decks);
  });
  room.onMessage('propList', (props) => {
    if (window.onLibraryList) window.onLibraryList('prop', props);
  });
  // Scene list → the Library's Scenes tab (via the hook); loading happens there.
  room.onMessage('sceneList', (scenes) => {
    if (window.onLibraryList) window.onLibraryList('scene', scenes);
  });
  room.onMessage('sceneError', ({ message } = {}) => alert(message || 'Could not save the scene.'));
  room.onMessage('stateSaved', () => {
    const b = byId('roomSaveState');
    if (!b) return;
    const label = b._saveLabel || b.querySelector('.lbl')?.textContent || 'Save Table';
    b._saveLabel = label;
    cancelDelay(b._saveFeedbackTimer);
    setIcon(b, 'square-check');
    setBtnLabel(b, 'Saved ✓');
    b._saveFeedbackTimer = delay(() => {
      setIcon(b, 'device-floppy');
      setBtnLabel(b, label);
    }, 1500);
  });
  room.onMessage('boardList', (boards) => {
    if (window.onLibraryList) window.onLibraryList('board', boards);
  });
  room.onMessage('matList', (mats) => {
    if (window.onLibraryList) window.onLibraryList('mat', mats);
  });
}
