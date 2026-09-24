import { ASSET_PACKAGE, ASSET_ARCHIVE } from '/shared/asset-package.js';

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
          : summary.kind === 'deck'
            ? `${summary.open ? 'Tile set' : 'Deck'} · ${summary.count} cards / tiles${summary.deckModel ? ' · Pouch skin' : ''}`
            : `Dice texture · ${summary.files[0].width} × ${summary.files[0].height}`;
      details.textContent = `${description} · ${(summary.totalBytes / 1024).toFixed(1)} KiB · ${summary.files.length} image${summary.files.length === 1 ? '' : 's'} included`;
      for (const member of summary.members || []) {
        const item = document.createElement('li');
        item.textContent = `${member.name} · ${member.kind === 'dice' ? 'dice texture' : `deck / tiles (${member.count})`}`;
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
          : `Imported “${result.name}” as a private ${result.kind === 'deck' ? 'deck / tile set' : 'dice texture'}. Find it under ${result.kind === 'deck' ? 'Card Decks/Tiles' : 'Dice'} with Custom or All selected; collection filters may hide it.`,
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
              : 'deck.ott.zip';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message('Export downloaded. It includes the asset and its required uploaded images.');
      } catch (error) {
        if (current === epoch) message(error.message);
      }
    },
    reset,
  };
}
