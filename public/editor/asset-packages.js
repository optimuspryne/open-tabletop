import { ASSET_PACKAGE, ASSET_ARCHIVE } from '/shared/asset-package.js';

const labels = {
  dice: 'Dice texture',
  deck: 'Deck / tile set',
  board: 'Board',
  mat: 'Player mat',
  sky: 'Skybox',
  prop: '3D model',
};
const panes = {
  dice: 'Dice',
  deck: 'Card Decks/Tiles',
  board: 'Game Boards',
  mat: 'Player Mats',
  sky: 'Skyboxes',
  prop: '3D Objects',
};
function assetDescription(asset) {
  if (asset.kind === 'dice' && asset.files?.[0])
    return `Dice texture · ${asset.files[0].width} × ${asset.files[0].height}`;
  if (asset.kind === 'deck')
    return `${asset.open ? 'Tile set' : 'Deck'} · ${asset.count} cards / tiles${asset.deckModel ? ' · Pouch skin' : ''}`;
  if (asset.kind === 'prop')
    return `3D model · ${asset.collider} collider${asset.dispenser ? ' · Dispenser definition' : ''}`;
  if (asset.kind === 'board' && asset.model) return `Model board · ${asset.collider} collider`;
  if (asset.kind === 'sky')
    return asset.type === 'cube' ? 'Skybox · 6-face cubemap' : 'Skybox · panorama';
  return labels[asset.kind];
}

// Portable assets stay in this library controller; room state never carries package bytes.
export function createAssetPackageController({ host, isAdmin, onImported }) {
  const find = (id) => host.querySelector('#' + id);
  const file = find('packageFile'),
    name = find('packageName'),
    preview = find('packagePreview');
  const status = find('packageStatus'),
    details = find('packageContents');
  const members = find('packageMembers');
  const save = find('packageImport'),
    cancel = find('packageCancel');
  let value = null,
    epoch = 0,
    busy = false,
    account = null;
  const message = (text) => {
    status.textContent = text;
  };
  function reset({ keepFile = false } = {}) {
    epoch++;
    value = null;
    if (!keepFile) file.value = '';
    name.value = '';
    details.textContent = '';
    members.replaceChildren();
    members.hidden = true;
    preview.hidden = true;
    busy = false;
    file.disabled = save.disabled = cancel.disabled = false;
    message('');
  }
  async function request(path, body) {
    const response = await fetch('/asset-packages/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('tabletop.token') || ''),
        ...(body === undefined
          ? {}
          : { 'Content-Type': body instanceof File ? 'application/zip' : 'application/json' }),
      },
      ...(body === undefined ? {} : { body: body instanceof File ? body : JSON.stringify(body) }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(
        result?.error ||
          (response.status === 413
            ? 'The package exceeds the server or reverse-proxy upload limit.'
            : `Asset transfer failed (HTTP ${response.status}).`),
      );
    }
    return body === undefined ? response.blob() : response.json();
  }
  file.onchange = async () => {
    const selected = file.files[0];
    reset({ keepFile: true });
    if (!selected || !isAdmin()) return;
    const current = epoch;
    busy = true;
    file.disabled = true;
    message('Checking package…');
    try {
      const archive = /\.zip$/i.test(selected.name) || selected.type === 'application/zip';
      if (selected.size > (archive ? ASSET_ARCHIVE.maxPackageBytes : ASSET_PACKAGE.maxPackageBytes))
        throw new Error(
          archive ? 'The ZIP package exceeds 544 MiB.' : 'The legacy JSON package exceeds 96 MiB.',
        );
      const candidate = archive ? selected : JSON.parse(await selected.text());
      if (current !== epoch || !isAdmin()) return;
      const summary = await request('preview', candidate);
      if (current !== epoch || !isAdmin()) return;
      value = candidate;
      name.value = summary.name;
      const description =
        summary.kind === 'collection'
          ? `Collection · ${summary.count} assets`
          : assetDescription(summary);
      details.textContent = `${description} · ${(summary.totalBytes / 1024).toFixed(1)} KiB · ${summary.files.length} file${summary.files.length === 1 ? '' : 's'} included`;
      for (const member of summary.members || []) {
        const item = document.createElement('li');
        item.textContent = `${member.name} · ${assetDescription(member)}`;
        members.append(item);
      }
      members.hidden = !members.childElementCount;
      preview.hidden = false;
      message(
        summary.kind === 'collection'
          ? 'A new private collection and private copies of all its members will be created.'
          : 'Ready to import. A new private copy will be created.',
      );
      name.focus({ preventScroll: true });
      preview.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      if (current === epoch)
        message(error instanceof SyntaxError ? 'The package is not valid JSON.' : error.message);
    } finally {
      if (current === epoch) {
        busy = false;
        file.disabled = false;
      }
    }
  };
  save.onclick = async () => {
    if (!value || busy || !isAdmin()) return;
    if (!name.reportValidity()) return;
    const current = epoch;
    busy = true;
    file.disabled = save.disabled = cancel.disabled = true;
    message('Importing…');
    try {
      const result =
        value instanceof File
          ? await request('import?name=' + encodeURIComponent(name.value), value)
          : await request('import', { package: value, name: name.value });
      if (current !== epoch || !isAdmin()) return;
      reset();
      message(
        result.kind === 'collection'
          ? `Imported “${result.name}” as a private collection with private asset copies. Find it under Collections.`
          : `Imported “${result.name}” as a private ${labels[result.kind].toLowerCase()}. Find it under ${panes[result.kind]} with Custom or All selected; collection filters may hide it.`,
      );
      onImported(result.kind);
    } catch (error) {
      if (current === epoch) message(error.message);
    } finally {
      if (current === epoch) {
        busy = false;
        file.disabled = save.disabled = cancel.disabled = false;
      }
    }
  };
  cancel.onclick = () => {
    reset();
    file.focus();
  };
  return {
    identity(id) {
      if (id !== account || !isAdmin()) reset();
      account = id;
      host.hidden = !isAdmin();
    },
    async exportAsset(kind, id) {
      if (!isAdmin()) return;
      const current = epoch;
      host.open = true;
      message('Preparing export…');
      status.scrollIntoView({ block: 'nearest' });
      try {
        const result = await request(kind + '/' + encodeURIComponent(id));
        if (current !== epoch || !isAdmin()) return;
        const url = URL.createObjectURL(result);
        const link = document.createElement('a');
        link.href = url;
        link.download =
          kind === 'collection'
            ? 'collection.ott.zip'
            : kind === 'dice'
              ? 'dice-texture.ott.zip'
              : kind + '.ott.zip';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message('Export downloaded. It includes the asset and its required original files.');
      } catch (error) {
        if (current === epoch) message(error.message);
      }
    },
    reset,
  };
}
