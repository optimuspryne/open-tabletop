import { inTable } from '../../../shared/pieces.js';

export function createRoomSeating({
  THREE,
  root,
  layout,
  chairTemplate,
  seatLayoutFor,
  clearance,
  name,
  resourceName,
  modelName,
  onChanged,
}) {
  const { hx, hz, floor, tableShape } = layout;
  const seatLayout = seatLayoutFor?.(layout.tableX, layout.tableZ) || [];
  let occupied = [];
  let occupiedKey = '';
  const chairs = new Map();
  function refreshChairs() {
    for (const chair of chairs.values()) {
      root.remove(chair);
      chair.traverse((node) => {
        if (node.isInstancedMesh) node.dispose();
      });
    }
    chairs.clear();
    for (const seat of occupied) {
      const layout = seatLayout[seat];
      const direction = new THREE.Vector3(layout.hand[0], 0, layout.hand[2]);
      if (direction.lengthSq() < 0.001) direction.set(...layout.out);
      direction.normalize();
      // Find the shared playable outline along this seat's center/hand line.
      let inner = 0,
        outer = Math.hypot(hx, hz) * 2;
      for (let step = 0; step < 24; step++) {
        const distance = (inner + outer) / 2;
        if (inTable(direction.x * distance, direction.z * distance, tableShape, hx, hz))
          inner = distance;
        else outer = distance;
      }
      const chair = chairTemplate.clone(true);
      chair.name = name;
      chair.userData.seat = seat;
      chair.visible = true;
      chair.position.copy(direction).multiplyScalar(outer + clearance);
      chair.position.y = floor;
      chair.rotation.y = Math.atan2(direction.x, direction.z);
      chair.traverse((node) => {
        if (resourceName && node.name === resourceName) node.name = modelName;
        if (node.isMesh) node.raycast = () => {};
      });
      root.add(chair);
      chairs.set(seat, chair);
    }
    onChanged();
  }
  const syncChairs = (players) => {
    const seats = new Set();
    players?.forEach((player) => {
      if (
        player.participation !== 'spectator' &&
        Number.isInteger(player.seat) &&
        player.seat >= 0 &&
        player.seat < seatLayout.length
      )
        seats.add(player.seat);
    });
    const next = [...seats].sort((a, b) => a - b);
    const key = next.join(',');
    if (key === occupiedKey) return;
    occupiedKey = key;
    occupied = next;
    refreshChairs();
  };
  return { sync: syncChairs, refresh: refreshChairs };
}
