import { canUseRoomCapability } from '../permissions.js';

const ASSET_LISTS = {
  deck: ['deckList', 'listDecks'],
  board: ['boardList', 'listBoards'],
  prop: ['propList', 'listProps'],
  scene: ['sceneList', 'listScenes'],
  sky: ['skyList', 'listSkyboxes'],
  dice: ['diceList', 'listDice'],
  mat: ['matList', 'listMats'],
};

// Own authorized room-facing library listing with injected database access.
export function createLibraryOperations({ db }) {
  const sendAssetList = async (room, client, kind) => {
    if (!canUseRoomCapability(client.auth ?? {}, 'observation')) return false;
    const includePrivate = room.isAdmin(client);
    const config = ASSET_LISTS[kind];
    if (!config) return false;
    const list = await db[config[1]]({ includePrivate });
    if (
      !canUseRoomCapability(client.auth ?? {}, 'observation') ||
      (includePrivate && !room.isAdmin(client))
    )
      return false;
    client.send(config[0], list);
    return true;
  };

  return { sendAssetList };
}
