import { RANK } from '../../permissions.js';
import {
  assetIdPayload,
  assetMutationPayload,
  boundedString,
  deckAppendPayload,
  deckBeginPayload,
  deckFinishPayload,
  namedIdPayload,
  oneField,
  saveBoardPayload,
  savePropPayload,
  saveSkyboxPayload,
} from '../../message-validation.js';
import { safeMessage } from '../safe-message.js';

const LIBRARY_ERROR = {
  errorType: 'assetError',
  publicMessage: 'Library unavailable. Try again.',
};

// Register the saved-asset library message family against a TableRoom-compatible
// object. Room capabilities stay injected so this module owns orchestration,
// validation, authorization, and database interaction without owning physics.
export function registerLibraryHandlers(
  room,
  {
    db,
    boardKeys,
    colliders,
    libraryKinds,
    refOk,
    sanitizeGeom,
    randomPosition,
    sceneMaxBytes,
    skyUrlOk,
    logger = console,
  },
) {
  const tableMessage = (type, handler) => safeMessage(room, type, handler, { logger });
  const assetMessage = (type, handler) =>
    safeMessage(room, type, handler, {
      logger,
      ...LIBRARY_ERROR,
    });

  tableMessage('deckBegin', (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = deckBeginPayload(message, { refOk, sanitizeGeom });
    if (!msg) return;
    room.drafts.set(client.sessionId, { back: msg.back, cards: [], geom: msg.geom });
  });

  tableMessage('deckAppend', (client, message) => {
    const draft = room.drafts.get(client.sessionId);
    if (!draft) return;
    const msg = deckAppendPayload(message, { refOk });
    if (!msg || draft.cards.length + msg.fronts.length > 1000) return;
    draft.cards.push(...msg.fronts);
  });

  assetMessage('deckFinish', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = deckFinishPayload(message);
    if (!msg) return;
    const draft = room.drafts.get(client.sessionId);
    room.drafts.delete(client.sessionId);
    if (!draft || !draft.cards.length) return;
    const geo = draft.geom ? { geom: draft.geom } : {};
    if (msg.spawn)
      room.spawn('deck', randomPosition(), { back: draft.back, cards: draft.cards, ...geo });
    if (!msg.name) return;
    if (msg.editId) {
      await db.updateDeck(msg.editId, msg.name, draft.back, draft.cards, draft.geom);
    } else {
      await db.insertDeck({
        name: msg.name,
        back: draft.back,
        fronts: draft.cards,
        geom: draft.geom,
        ownerId: client.auth.userId,
        isPublic: false,
      });
    }
    await room.sendAssetList(client, 'deck');
  });

  assetMessage('saveDeck', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = namedIdPayload(message, { idKey: 'deckId' });
    if (!msg) return;
    if (await room.saveDeckById(msg.deckId, msg.name, client.auth.userId)) {
      await room.sendAssetList(client, 'deck');
    }
  });
  assetMessage('listDecks', (client) => room.sendAssetList(client, 'deck'));
  assetMessage('loadDeck', async (client, message) => {
    if (room.rank(client) < RANK.helper) return;
    const msg = assetIdPayload(message);
    if (!msg) return;
    const deck = await db.getDeck(msg.id);
    if (!deck || (!deck.isPublic && !room.isAdmin(client))) return;
    room.spawn('deck', randomPosition(), {
      back: deck.back,
      cards: deck.fronts,
      ...(deck.geom ? { geom: deck.geom } : {}),
    });
  });

  assetMessage('saveBoard', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = saveBoardPayload(message, { boardKeys });
    if (!msg) return;
    if (msg.editId) await db.updateBoard(msg.editId, msg.name, msg.board);
    else await db.insertBoard(msg.name, msg.board, { ownerId: client.auth.userId });
    await room.sendAssetList(client, 'board');
  });
  assetMessage('listBoards', (client) => room.sendAssetList(client, 'board'));

  assetMessage('saveProp', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = savePropPayload(message, { colliders });
    if (!msg) return;
    if (msg.editId) await db.updateProp(msg.editId, msg.name, msg.props);
    else await db.insertProp(msg.name, msg.props, { ownerId: client.auth.userId });
    await room.sendAssetList(client, 'prop');
  });
  assetMessage('listProps', (client) => room.sendAssetList(client, 'prop'));

  assetMessage('assetPublic', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = assetMutationPayload(message, { kinds: libraryKinds, mode: 'public' });
    if (!msg) return;
    await db.setAssetPublic(msg.kind, msg.id, msg.isPublic);
    await room.sendAssetList(client, msg.kind);
  });
  assetMessage('assetRename', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = assetMutationPayload(message, { kinds: libraryKinds, mode: 'rename' });
    if (!msg) return;
    await db.renameAsset(msg.kind, msg.id, msg.name);
    await room.sendAssetList(client, msg.kind);
  });
  assetMessage('getDeck', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = assetIdPayload(message);
    if (!msg) return;
    const deck = await db.getDeck(msg.id);
    if (deck)
      client.send('deckData', {
        id: msg.id,
        name: deck.name,
        back: deck.back,
        fronts: deck.fronts,
        geom: deck.geom,
      });
  });
  assetMessage('assetDelete', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const msg = assetMutationPayload(message, { kinds: libraryKinds, mode: 'delete' });
    if (!msg) return;
    await db.deleteAsset(msg.kind, msg.id);
    await room.sendAssetList(client, msg.kind);
  });

  assetMessage('listScenes', (client) => room.sendAssetList(client, 'scene'));
  assetMessage('sceneSave', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const parsed = oneField(message, 'name', (name) => boundedString(name, { min: 1, max: 60 }));
    if (!parsed || !parsed.name.trim()) return;
    const payload = room.serializeScene();
    if (JSON.stringify(payload).length > sceneMaxBytes) {
      client.send('sceneError', {
        message:
          'Scene is too large to save. Save its decks to the library first so their card art is stored as files, then try again.',
      });
      return;
    }
    await db.insertScene({ name: parsed.name.trim(), payload, ownerId: client.auth.userId });
    await room.sendAssetList(client, 'scene');
  });
  assetMessage('sceneLoad', async (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const msg = assetIdPayload(message);
    if (!msg) return;
    const scene = await db.getScene(msg.id);
    if (!scene || (!scene.isPublic && !room.isAdmin(client))) return;
    room.applyScene(scene.payload);
  });

  assetMessage('loadBoard', async (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const msg = assetIdPayload(message);
    if (!msg) return;
    const data = await db.getBoard(msg.id);
    if (!data || (!data.isPublic && !room.isAdmin(client))) return;
    const rec = data.rec;
    const props = rec.board
      ? { board: rec.board }
      : rec.model
        ? { model: rec.model, modelScale: rec.modelScale, box: rec.box }
        : { w: rec.w, d: rec.d, tex: rec.tex || undefined };
    room.swapBoard(props);
  });

  assetMessage('listSkyboxes', (client) => room.sendAssetList(client, 'sky'));
  assetMessage('saveSkybox', async (client, message) => {
    if (!room.isAdmin(client)) return;
    const fail = (message) => client.send('skyError', { message });
    const msg = saveSkyboxPayload(message, { urlOk: skyUrlOk });
    if (!msg) return fail('Invalid skybox details.');
    const url = msg.type === 'cube' ? JSON.stringify({ t: 'cube', f: msg.faces }) : msg.url;
    await db.insertSkybox({
      name: msg.name,
      url,
      ownerId: client.auth.userId,
      isPublic: msg.isPublic,
    });
    await room.sendAssetList(client, 'sky');
  });
}
