// editor-panel.js — the admin library-management panel (editor.html only). It rides
// on the table engine's room connection, handed over by client.js via
// window.onOttRoom, and gets asset lists via window.onLibraryList (client.js fans
// the deckList/boardList/propList messages out to here, so the modal saved-lists
// keep working too). In the editor the admin sees private assets as well as public.
const $ = (id) => document.getElementById(id);
const btn = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };

let ROOM = null;
const LIST_UL = { deck: 'libDecks', board: 'libBoards', prop: 'libProps' };
const spawnOf = {
  deck: (it) => ROOM.send('loadDeck', { id: it.id }),
  board: (it) => ROOM.send('loadBoard', { id: it.id }),
  prop: (it) => ROOM.send('spawn', { type: 'prop', props: it.props }),
};

function renderList(kind, list) {
  const ul = $(LIST_UL[kind]); if (!ul) return;
  ul.replaceChildren();
  if (!list.length) { const li = document.createElement('li'); li.className = 'libEmpty'; li.textContent = 'None yet.'; ul.appendChild(li); return; }
  for (const it of list) {
    const li = document.createElement('li'); li.className = 'libRow';
    const extra = kind === 'deck' && it.count != null ? ` \u00b7 ${it.count}` : (kind === 'board' && it.kind ? ` \u00b7 ${it.kind}` : '');
    const name = document.createElement('span'); name.className = 'libName'; name.textContent = it.name + extra;
    const badge = document.createElement('span'); badge.className = 'libBadge ' + (it.isPublic ? 'pub' : 'priv'); badge.textContent = it.isPublic ? 'public' : 'private';
    const acts = document.createElement('span'); acts.className = 'libActs';
    acts.append(
      btn('Spawn', () => spawnOf[kind](it)),
      btn(it.isPublic ? 'Unpublish' : 'Publish', () => ROOM.send('assetPublic', { kind, id: it.id, isPublic: !it.isPublic })),
      btn('Rename', () => { const n = prompt('Rename:', it.name); if (n && n.trim()) ROOM.send('assetRename', { kind, id: it.id, name: n.trim() }); }),
      btn('Delete', () => { if (confirm(`Delete "${it.name}"? This cannot be undone.`)) ROOM.send('assetDelete', { kind, id: it.id }); }, 'danger'),
    );
    li.append(name, badge, acts);
    ul.appendChild(li);
  }
}

// client.js fans the three list messages here (and still renders the modal saved-lists).
window.onLibraryList = (kind, list) => renderList(kind, list);

// client.js hands over the live room once connected.
window.onOttRoom = (room) => {
  ROOM = room;
  const panel = $('libraryPanel');
  const refresh = () => { room.send('listDecks'); room.send('listBoards'); room.send('listProps'); };
  $('libraryBtn').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) refresh(); };
  $('libraryClose').onclick = () => { panel.hidden = true; };
  refresh(); // prime the lists so the panel is populated on first open
};
