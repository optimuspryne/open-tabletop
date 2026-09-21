import { drawGroupThumbnail } from './collider-groups.js';

// The library is account-backed. Insertion returns a snapshot, never a live reference.
export function wireColliderPresets(host, { capture, insert }) {
  host.innerHTML = `<summary>Saved collider collections</summary>
    <p>Select shapes, then save a reusable collection. Ctrl/⌘-click or Shift-click to select more than one.</p>
    <button type="button" class="button" data-preset="refresh">Refresh library</button>
    <label>Collection <select class="control control--select" data-preset="list" aria-label="Saved collider collection"><option value="">Choose a collection</option></select></label>
    <button type="button" class="button" data-preset="more" hidden>Load more</button>
    <canvas data-preset="preview" width="280" height="150" aria-label="Collection preview"></canvas>
    <label>Name <input class="control" type="text" data-preset="name" maxlength="120" placeholder="Hollow hexagon"></label>
    <label>Visibility <select class="control control--select" data-preset="visibility"><option value="private">Private</option><option value="public">Public</option></select></label>
    <label>Insert size (longest side, table units) <input class="control control--compact" data-preset="size" type="number" min="0.001" max="400" step="0.1" value="1"></label>
    <div class="compoundPresetActions"><button type="button" class="button button--primary" data-preset="insert" disabled>Insert copy</button>
    <button type="button" class="button" data-preset="save">Save selection as new</button>
    <button type="button" class="button" data-preset="metadata" disabled>Save name / visibility</button>
    <button type="button" class="button" data-preset="replace" disabled>Replace with selection</button>
    <button type="button" class="button button--danger" data-preset="delete" disabled>Delete collection</button></div>
    <p data-preset="status" role="status"></p>`;
  const field = (name) => host.querySelector(`[data-preset="${name}"]`);
  let records = [],
    current = null,
    nextOffset = null,
    busy = false,
    loaded = false;
  async function request(path = '', method = 'GET', body) {
    const response = await fetch('/collider-presets' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('tabletop.token') || ''),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to access collider collections.');
    return result;
  }
  function buttons() {
    for (const name of ['insert', 'metadata', 'replace', 'delete'])
      field(name).disabled = busy || !current || (name !== 'insert' && !current.canEdit);
    for (const name of ['save', 'refresh', 'more', 'list']) field(name).disabled = busy;
  }
  async function task(work) {
    if (busy) return;
    busy = true;
    buttons();
    try {
      await work();
    } catch (error) {
      field('status').textContent = error.message;
    } finally {
      busy = false;
      buttons();
    }
  }
  function show(preset) {
    current = preset;
    if (preset && !records.some((record) => record.id === preset.id)) {
      records.push(preset);
      field('list').add(new Option(preset.name, preset.id));
    }
    field('list').value = preset?.id || '';
    if (preset) {
      field('name').value = preset.name;
      field('visibility').value = preset.isPublic ? 'public' : 'private';
      field('size').value = +preset.size.toFixed(4);
    }
    drawGroupThumbnail(field('preview'), preset?.layout);
    buttons();
  }
  async function load(more = false) {
    const result = await request(more ? `?offset=${nextOffset}` : '');
    records = more ? [...records, ...result.presets] : result.presets;
    nextOffset = result.nextOffset;
    field('more').hidden = nextOffset === null;
    field('list').replaceChildren(
      new Option('Choose a collection', ''),
      ...records.map(
        (r) =>
          new Option(
            `${r.name} (${r.isPublic ? 'public' : 'private'}${r.canEdit ? ', editable' : ''})`,
            r.id,
          ),
      ),
    );
    show(records.find((r) => r.id === current?.id) || null);
    loaded = true;
  }
  host.addEventListener('toggle', () => {
    if (host.open && !loaded) task(() => load());
  });
  field('refresh').onclick = () => task(() => load());
  field('more').onclick = () => task(() => load(true));
  field('list').onchange = () => show(records.find((r) => r.id === field('list').value));
  const metadata = () => ({
    name: field('name').value.trim(),
    isPublic: field('visibility').value === 'public',
  });
  field('save').onclick = () =>
    task(async () => {
      const value = { ...capture(), ...metadata() };
      const { preset } = await request('', 'POST', value);
      await load();
      show(preset);
      field('status').textContent = 'Collection saved to your account.';
    });
  for (const name of ['metadata', 'replace'])
    field(name).onclick = () =>
      task(async () => {
        const value =
          name === 'replace' ? capture() : { layout: current.layout, size: current.size };
        const { preset } = await request('/' + current.id, 'PUT', { ...value, ...metadata() });
        await load();
        show(preset);
        field('status').textContent =
          'Collection updated. Previously inserted copies are unchanged.';
      });
  field('insert').onclick = () =>
    task(async () => {
      const size = Number(field('size').value);
      if (!Number.isFinite(size) || size < 0.001 || size > 400)
        throw new Error('Enter a size between 0.001 and 400.');
      const { preset } = await request('/' + current.id);
      insert(preset, size);
      field('status').textContent =
        'Copy inserted and selected. Move, rotate, or resize the group.';
    });
  field('delete').onclick = () =>
    task(async () => {
      if (
        !window.confirm(`Delete “${current.name}” from the library? Existing copies will remain.`)
      )
        return;
      await request('/' + current.id, 'DELETE');
      current = null;
      await load();
      field('status').textContent = 'Collection deleted.';
    });
}
