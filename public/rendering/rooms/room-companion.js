// Visual room scenery, owned by the usual furnishing loader and room cleanup.
export const ROOM_COMPANION = Object.freeze({
  cornerInsetX: 3.6,
  cornerInsetZ: 3.7,
  yaw: (Math.PI * 3) / 4,
  bedWidth: 4.42,
  bedDepth: 3.83,
  shadowLift: 0.035,
});

export const ROOM_COMPANION_ASSETS = Object.freeze({
  pup: Object.freeze({
    url: '/models/environments/shared/gray-pup-in-bed.glb',
    scale: 7,
    name: 'Resting gray dog model',
  }),
});

export function buildRoomCompanion({ THREE, layout, assembly }) {
  const config = ROOM_COMPANION;
  const slot = assembly.group(
    'Resting gray dog',
    [-layout.rx + config.cornerInsetX, layout.floor, layout.rz - config.cornerInsetZ],
    config.yaw,
  );
  const fallback = new THREE.Group();
  fallback.name = 'Dog bed fallback';
  slot.add(fallback);
  const geometry = new THREE.SphereGeometry(1, 24, 12);
  for (const [width, depth, height, y, color] of [
    [config.bedWidth, config.bedDepth, 0.45, 0.25, '#476678'],
    [config.bedWidth * 0.74, config.bedDepth * 0.72, 0.18, 0.48, '#c9c5b3'],
  ]) {
    const cushion = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
    );
    cushion.scale.set(width / 2, height / 2, depth / 2);
    cushion.position.y = y;
    fallback.add(cushion);
  }
  assembly.contact(slot, [{ width: 4.9, depth: 4.3 }], config.shadowLift);
  assembly.furnishing('pup', slot, fallback);
  return slot;
}
