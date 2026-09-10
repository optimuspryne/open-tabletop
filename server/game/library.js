import { readProps } from './props-codec.js';

const ASSET_LISTS = {
  deck: ['deckList', 'listDecks'],
  board: ['boardList', 'listBoards'],
  prop: ['propList', 'listProps'],
  scene: ['sceneList', 'listScenes'],
  sky: ['skyList', 'listSkyboxes'],
  dice: ['diceList', 'listDice'],
  mat: ['matList', 'listMats'],
};

const isDataURL = (value) => typeof value === 'string' && value.startsWith('data:image');

// Own the room-facing saved-library operations while filesystem storage and database access stay
// injected. Handlers retain validation and operation-specific permission checks.
export function createLibraryOperations({ db, saveImageRef }) {
  const saveDeckById = async (room, deckId, name, ownerId = null) => {
    const fronts = room.deckCards.get(deckId);
    const piece = room.state.pieces.get(deckId);
    if (!fronts || !fronts.length || !piece || piece.type !== 'deck') return false;
    const cleanName = String(name || '')
      .slice(0, 60)
      .trim();
    if (!cleanName) return false;
    let back = readProps(piece).back || 'back';
    if (isDataURL(back)) back = saveImageRef(back, 'decks') || 'back';
    const savedFronts = fronts.map((front) =>
      isDataURL(front) ? saveImageRef(front, 'decks') || front : front,
    );
    await db.insertDeck({ name: cleanName, back, fronts: savedFronts, ownerId });
    return true;
  };

  const sendAssetList = async (room, client, kind) => {
    if (client.auth?.revoked) return false;
    const includePrivate = room.isAdmin(client);
    const config = ASSET_LISTS[kind];
    if (!config) return false;
    const list = await db[config[1]]({ includePrivate });
    if (client.auth?.revoked || (includePrivate && !room.isAdmin(client))) return false;
    client.send(config[0], list);
    return true;
  };

  return { saveDeckById, sendAssetList };
}
