import { ASSET_PACKAGE } from '/shared/asset-package.js';

// Portable assets stay in this library controller; room state never carries package bytes.
export function createAssetPackageController({ host, isAdmin, onImported }) {
  const find = (id) => host.querySelector('#' + id);
  const file = find('packageFile'),
    name = find('packageName'),
    preview = find('packagePreview');
  const status = find('packageStatus'),
    details = find('packageContents');
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
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Asset transfer failed.');
    return result;
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
      if (selected.size > ASSET_PACKAGE.maxPackageBytes)
        throw new Error('The package exceeds 12 MiB.');
      const candidate = JSON.parse(await selected.text());
      if (current !== epoch || !isAdmin()) return;
      const summary = await request('preview', candidate);
      if (current !== epoch || !isAdmin()) return;
      value = candidate;
      name.value = summary.name;
      details.textContent = `Dice texture · ${summary.files[0].width} × ${summary.files[0].height} · ${(summary.totalBytes / 1024).toFixed(1)} KiB · 1 image included`;
      preview.hidden = false;
      message('Ready to import. A new private copy will be created.');
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
      const result = await request('import', { package: value, name: name.value });
      if (current !== epoch || !isAdmin()) return;
      reset();
      message(
        `Imported “${result.name}” as a private dice texture. Find it under Dice with Custom or All selected; collection filters may hide it.`,
      );
      onImported();
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
    async exportDice(id) {
      if (!isAdmin()) return;
      const current = epoch;
      host.open = true;
      message('Preparing export…');
      status.scrollIntoView({ block: 'nearest' });
      try {
        const result = await request('dice/' + encodeURIComponent(id));
        if (current !== epoch || !isAdmin()) return;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(result)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'dice-texture.ott.json';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message('Export downloaded. It includes the dice texture and its original image.');
      } catch (error) {
        if (current === epoch) message(error.message);
      }
    },
    reset,
  };
}
