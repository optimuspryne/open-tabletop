import { setIcon } from '../ui/icons.js';
import {
  COLLECTION_KINDS,
  COLLECTION_LIMITS,
  collectionAllows,
  collectionItemKey,
} from '/shared/asset-collections.js';

// Library-only organization: finish pickers and already-spawned objects are independent.
export function createCollectionController({
  host,
  room,
  isAdmin,
  getAssets,
  onFilter,
  onExport,
  storage = localStorage,
}) {
  let collections = [],
    hidden = new Set(),
    account = '',
    request = 0,
    pages = [],
    ready = false;
  let draft = null,
    busy = false;
  const element = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, icon, action) => {
    const node = element('button', 'button');
    node.append(element('span', 'lbl', label));
    node.setAttribute('aria-label', label);
    setIcon(node, icon);
    node.type = 'button';
    node.dataset.icon = icon;
    node.onclick = action;
    return node;
  };
  const status = element('p', 'help-text');
  status.setAttribute('role', 'status');
  const filters = element('div', 'collectionFilters');
  const actions = element('div', 'button-row button-row--compact');
  const manager = element('section', 'collectionManager');
  manager.hidden = true;
  const name = element('input', 'control');
  name.maxLength = COLLECTION_LIMITS.name;
  name.setAttribute('aria-label', 'Collection name');
  name.placeholder = 'Collection name';
  const published = element('input');
  published.type = 'checkbox';
  const publicLabel = element('label', 'collectionChoice');
  publicLabel.append(published, document.createTextNode('Published collection'));
  const hint = element(
    'p',
    'help-text',
    'Publishing a collection does not publish its assets. Deleting a collection keeps its assets.',
  );
  const search = element('input', 'control');
  search.type = 'search';
  search.placeholder = 'Find assets to include';
  search.setAttribute('aria-label', 'Find assets to include');
  const inventory = element('div', 'collectionInventory');
  const count = element('p', 'help-text');
  const controls = element('div', 'button-row button-row--compact collectionControls');
  const save = button('Save collection', 'device-floppy', () => submit());
  save.classList.add('button--primary');
  const reload = button('Reload draft', 'refresh', () => {
    if (!draft || busy || !confirm('Discard this draft and reload the latest collection?')) return;
    const latest = collections.find((value) => value.id === draft.id);
    if (latest) {
      draft = null;
      edit(latest);
    } else {
      draft = null;
      manager.hidden = true;
    }
  });
  const remove = button('Delete collection', 'trash', () => {
    if (
      !draft?.id ||
      busy ||
      !confirm(`Delete “${draft.name}”? Its assets will stay in the library.`)
    )
      return;
    setBusy(true);
    room.send('deleteCollection', { id: draft.id, revision: draft.revision });
  });
  remove.classList.add('button--danger');
  const cancel = button('Cancel', 'x', () => {
    if (!busy) {
      draft = null;
      manager.hidden = true;
    }
  });
  controls.append(save, reload, remove, cancel);
  manager.append(name, publicLabel, hint, search, count, inventory, controls);
  host.replaceChildren(filters, actions, status, manager);
  // Inputs/buttons already use the normal intent layer's editable/UI exclusions.
  manager.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });
  search.oninput = () => renderInventory();
  function setBusy(value) {
    busy = value;
    for (const node of manager.querySelectorAll('input, button')) node.disabled = value;
    renderFilters();
  }
  function persist() {
    if (!account) return;
    try {
      storage.setItem(`ott.collections.${account}`, JSON.stringify([...hidden]));
    } catch {
      /* optional local preference */
    }
  }
  function refresh() {
    pages = [];
    request += 1;
    status.textContent = 'Loading collections…';
    room.send('listCollections', { request });
  }
  function renderFilters() {
    filters.replaceChildren();
    actions.replaceChildren();
    const choice = (id, label) => {
      const input = element('input');
      input.type = 'checkbox';
      input.checked = !hidden.has(id);
      input.onchange = () => {
        if (input.checked) hidden.delete(id);
        else hidden.add(id);
        persist();
        onFilter();
      };
      const item = element('label', 'collectionChoice');
      item.append(input, document.createTextNode(label));
      filters.append(item);
    };
    choice('uncollected', 'Uncollected');
    for (const value of collections) {
      const wrap = element('span', 'collectionFilter');
      choice(
        value.id,
        `${value.name} (${value.items.length})${value.isPublic ? '' : ' · private'}`,
      );
      wrap.append(filters.lastElementChild);
      if (isAdmin()) {
        const editButton = button('Edit', 'edit', () => {
          if (!busy) edit(value);
        });
        editButton.setAttribute('aria-label', `Edit ${value.name}`);
        editButton.classList.add('button--icon');
        editButton.disabled = busy;
        wrap.append(editButton);
        if (onExport) {
          const exportButton = button('Export', 'device-floppy', () => onExport(value.id));
          exportButton.setAttribute('aria-label', `Export saved collection ${value.name}`);
          exportButton.title = 'Export saved collection';
          exportButton.classList.add('button--icon');
          exportButton.disabled = busy;
          wrap.append(exportButton);
        }
      }
      filters.append(wrap);
    }
    actions.append(
      button('Show all', 'eye', () => {
        hidden.clear();
        persist();
        renderFilters();
        onFilter();
      }),
    );
    actions.append(button('Refresh collections', 'refresh', refresh));
    if (isAdmin()) {
      const create = button('New collection', 'plus', () => {
        if (!busy) edit(null);
      });
      create.disabled = busy;
      actions.append(create);
    }
  }
  function edit(value) {
    if (!isAdmin()) return;
    if (draft && !confirm('Discard the current collection draft?')) return;
    draft = value
      ? { ...value, selected: new Map(value.items.map((item) => [collectionItemKey(item), item])) }
      : { id: null, name: '', isPublic: false, selected: new Map() };
    name.value = draft.name;
    published.checked = draft.isPublic;
    search.value = '';
    manager.hidden = false;
    reload.hidden = remove.hidden = !draft.id;
    search.hidden = inventory.hidden = count.hidden = !draft.id;
    status.textContent = draft.id
      ? 'Choose assets, then save your changes.'
      : 'Create a collection, then choose its assets.';
    renderInventory();
    manager.scrollIntoView({ block: 'start' });
    name.focus({ preventScroll: true });
  }
  function renderInventory() {
    if (!draft) return;
    inventory.replaceChildren();
    count.textContent = `${draft.selected.size} / ${COLLECTION_LIMITS.items} assets selected`;
    const query = search.value.trim().toLowerCase();
    for (const kind of COLLECTION_KINDS) {
      for (const asset of getAssets()[kind] || []) {
        if (query && !`${kind} ${asset.name}`.toLowerCase().includes(query)) continue;
        const item = { kind, id: asset.id },
          key = collectionItemKey(item);
        const input = element('input');
        input.type = 'checkbox';
        input.checked = draft.selected.has(key);
        input.disabled = busy;
        input.onchange = () => {
          if (input.checked && draft.selected.size >= COLLECTION_LIMITS.items) {
            input.checked = false;
            status.textContent = `Choose at most ${COLLECTION_LIMITS.items} assets.`;
            return;
          }
          if (input.checked) draft.selected.set(key, item);
          else draft.selected.delete(key);
          count.textContent = `${draft.selected.size} / ${COLLECTION_LIMITS.items} assets selected`;
        };
        const label = element('label', 'collectionChoice');
        label.append(
          input,
          document.createTextNode(`${asset.name} · ${kind}${asset.isPublic ? '' : ' · private'}`),
        );
        inventory.append(label);
      }
    }
    if (!inventory.childElementCount)
      inventory.append(element('p', 'help-text', 'No matching assets.'));
  }
  function submit() {
    if (!draft || busy || !isAdmin()) return;
    const cleanName = name.value.trim();
    if (!cleanName) {
      status.textContent = 'Enter a collection name.';
      name.focus();
      return;
    }
    setBusy(true);
    status.textContent = 'Saving collection…';
    room.send(draft.id ? 'updateCollection' : 'createCollection', {
      ...(draft.id
        ? { id: draft.id, revision: draft.revision, items: [...draft.selected.values()] }
        : {}),
      name: cleanName,
      isPublic: published.checked,
    });
  }
  room.onMessage('collectionList', (message) => {
    if (message.request !== request) return;
    pages.push(...message.collections);
    if (message.next) {
      room.send('listCollections', { request, after: message.next });
      return;
    }
    collections = pages;
    ready = true;
    const available = new Set(['uncollected', ...collections.map((value) => value.id)]);
    hidden = new Set([...hidden].filter((id) => available.has(id)));
    persist();
    if (!draft)
      status.textContent = collections.length
        ? 'Visibility choices apply only to your library.'
        : 'No collections yet. Assets appear under Uncollected.';
    renderFilters();
    onFilter();
  });
  room.onMessage('collectionsChanged', () => {
    refresh();
    for (const kind of ['Decks', 'Boards', 'Mats', 'Props', 'Scenes', 'Skyboxes', 'Dice'])
      room.send('list' + kind);
  });
  room.onMessage('collectionSaved', ({ id, operation }) => {
    setBusy(false);
    draft = null;
    manager.hidden = true;
    status.textContent =
      operation === 'create'
        ? 'Collection created. Choose Edit to add assets.'
        : 'Collection saved.';
    // Keep newly created collections visible even if a stale local preference exists.
    hidden.delete(id);
    refresh();
  });
  room.onMessage('collectionError', ({ message, operation }) => {
    if (operation !== 'listCollections') setBusy(false);
    status.textContent = message || 'Collections unavailable. Try again.';
  });
  function identity(userId) {
    const next = userId ? String(userId) : '';
    if (account !== next) {
      account = next;
      hidden.clear();
      try {
        const saved = JSON.parse(storage.getItem(`ott.collections.${account}`) || '[]');
        if (Array.isArray(saved)) hidden = new Set(saved.filter((id) => typeof id === 'string'));
      } catch {
        /* invalid preference */
      }
    }
    // Drop private metadata immediately on an admin transition, then refetch authorized rows.
    collections = [];
    ready = false;
    draft = null;
    manager.hidden = true;
    setBusy(false);
    refresh();
    onFilter();
  }
  renderFilters();
  return {
    refresh,
    identity,
    assetsChanged: renderInventory,
    allows: (kind, id) => ready && collectionAllows(collections, hidden, kind, id),
  };
}
