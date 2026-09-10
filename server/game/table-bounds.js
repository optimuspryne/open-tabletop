import * as CANNON from 'cannon-es';
import { tableOutline } from '../../shared/pieces.js';

// Build the physical table surface and containment ring from the server's physics tuning.
// Browser rendering remains separate; both sides agree only on the shared perimeter outline.
export function createTableBounds({ tableThickness, wall }) {
  return function buildTableBounds(
    room,
    hx,
    hz,
    shape = (room.state && room.state.tableShape) || 'rect',
  ) {
    const world = room.world;
    const material = world.__mat;
    for (const body of room._bounds || []) world.removeBody(body);
    room._bounds = [];

    const add = (body) => {
      world.addBody(body);
      room._bounds.push(body);
    };
    const table = new CANNON.Body({ mass: 0, material });
    table.addShape(new CANNON.Box(new CANNON.Vec3(hx, tableThickness, hz)));
    table.position.set(0, -tableThickness, 0);
    add(table);

    if (shape && shape !== 'rect') {
      // Seal each shared-outline edge with a slightly overlapping oriented box.
      const outline = tableOutline(shape, hx, hz);
      const seal = wall.thick;
      for (let index = 0; index < outline.length; index++) {
        const a = outline[index];
        const b = outline[(index + 1) % outline.length];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (!(length > 0)) continue;
        const body = new CANNON.Body({ mass: 0, material });
        body.addShape(new CANNON.Box(new CANNON.Vec3(length / 2 + seal, wall.half, wall.thick)));
        body.position.set((a.x + b.x) / 2, wall.half, (a.z + b.z) / 2);
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.atan2(dz, dx));
        add(body);
      }
    } else {
      const addWall = (x, z, wallX, wallZ) => {
        const body = new CANNON.Body({ mass: 0, material });
        body.addShape(new CANNON.Box(new CANNON.Vec3(wallX, wall.half, wallZ)));
        body.position.set(x, wall.half, z);
        add(body);
      };
      addWall(0, -(hz + wall.thick), hx + wall.over, wall.thick);
      addWall(0, hz + wall.thick, hx + wall.over, wall.thick);
      addWall(-(hx + wall.thick), 0, wall.thick, hz + wall.over);
      addWall(hx + wall.thick, 0, wall.thick, hz + wall.over);
    }

    // Personal trays follow the table track and must be rebuilt after any boundary change.
    room.buildTrays();
  };
}
