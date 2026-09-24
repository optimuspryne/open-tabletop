import { canUseRoomCapability } from '../permissions.js';
import { safeMessage } from './safe-message.js';

// Explicit inventory of client requests, not a replacement for handler-specific
// role/access checks. Mixed administration + spawn requests also check gameplay
// after validation and again after asynchronous work, immediately before spawning.
const messagesByCapability = {
  observation: [
    'chatLog',
    'handSync',
    'whoami',
    'wbStrokes',
    'notebookSync',
    'listDecks',
    'listBoards',
    'listMats',
    'listProps',
    'listScenes',
    'listSkyboxes',
    'listDice',
  ],
  communication: ['chat', 'ping', 'highlightPiece'],
  personal: ['notebook', 'setName', 'setAvatar'],
  cleanup: ['showStop', 'wbRelease'],
  administration: [
    'members',
    'admit',
    'kick',
    'setRole',
    'deckBegin',
    'deckAppend',
    'deckFinish',
    'saveDeck',
    'saveBoard',
    'saveMat',
    'saveProp',
    'removePropDispenser',
    'assetPublic',
    'assetRename',
    'getDeck',
    'assetDelete',
    'sceneSave',
    'saveSkybox',
    'saveDice',
  ],
  gameplay: [
    'grab',
    'move',
    'release',
    'grabGroup',
    'moveGroup',
    'releaseGroup',
    'setPieceLabels',
    'setStandGroup',
    'setSnapGroup',
    'rollGroup',
    'flipGroup',
    'setOpenGroup',
    'takeGroup',
    'rotateGroup',
    'recolor',
    'recolorGroup',
    'spawn',
    'rollOne',
    'setStand',
    'setSnap',
    'snap',
    'remove',
    'removeGroup',
    'gatherDispensers',
    'absorbIntoDispenser',
    'dispenseFromPieces',
    'flip',
    'dealToTable',
    'drawToHand',
    'dealDrag',
    'takeCard',
    'drawInspect',
    'inspectPlace',
    'shuffle',
    'splitDeck',
    'combineIntoDeck',
    'dispense',
    'dispenseDrag',
    'playCard',
    'handToTable',
    'reorderHand',
    'handFromTable',
    'reset',
    'loadStarter',
    'nextTurn',
    'turnOrder',
    'reassignHand',
    'loadDeck',
    'loadMat',
    'loadProp',
    'sceneLoad',
    'loadBoard',
    'stateSave',
    'timer',
    'score',
    'roomNotes',
    'table',
    'tableColor',
    'lightingApply',
    'lightingRestore',
    'lightingDefaultSave',
    'lightingFactoryReset',
    'scaleSet',
    'calibrateGrid',
    'overlayAdd',
    'overlayMove',
    'overlayRemove',
    'overlayClear',
    'overlayDrag',
    'wbEnable',
    'wbSet',
    'wbClaim',
    'wbStroke',
    'wbClear',
    'roll',
    'trayScoop',
    'trayClear',
    'trayShow',
    'skybox',
    'showStart',
  ],
};

export const ROOM_MESSAGE_CAPABILITIES = Object.freeze(
  Object.fromEntries(
    Object.entries(messagesByCapability).flatMap(([capability, types]) =>
      types.map((type) => [type, capability]),
    ),
  ),
);

// Also used at async continuation boundaries. No client payload participates in
// authorization; auth is server-owned. Lifecycle recovery never calls this gate.
export function allowRoomCapability(client, capability, operation) {
  if (client && canUseRoomCapability(client.auth ?? {}, capability)) return true;
  if (client && !client.auth?.revoked) {
    client.send('serverError', {
      operation,
      message:
        client.auth?.participationReady === false
          ? 'Your table access is still loading. Try again shortly.'
          : 'Table interaction is unavailable while spectating or in time-out.',
    });
  }
  return false;
}

export function guardedMessage(room, type, handler, options) {
  if (!Object.hasOwn(ROOM_MESSAGE_CAPABILITIES, type)) {
    throw new Error(`Unclassified table message: ${type}`);
  }
  const capability = ROOM_MESSAGE_CAPABILITIES[type];
  safeMessage(
    room,
    type,
    (client, message) => {
      if (!allowRoomCapability(client, capability, type)) return;
      return handler(client, message);
    },
    options,
  );
}
