// Bounded native stone instances; geometry/materials stay with the room assembly.
export function buildRoomPaving({ THREE, layout, assembly, materials, phoneSafe }, config) {
  const { rx, rz, floor } = layout;
  const columns = Math.min(config.maximumPaverAxis, Math.ceil((rx * 2) / config.paverStep));
  const rows = Math.min(config.maximumPaverAxis, Math.ceil((rz * 2) / config.paverStep));
  const width = (rx * 2) / columns,
    depth = (rz * 2) / rows;
  const slot = assembly.group(`${config.name} paving slot`, [0, floor, 0]);
  const fallback = new THREE.Group();
  slot.add(fallback);
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++)
      assembly.box(
        fallback,
        [width - config.paverGap, 0.12, depth - config.paverGap],
        [-rx + (column + 0.5) * width, -0.01, -rz + (row + 0.5) * depth],
        '#ffffff',
        materials.stone,
      );
  assembly.furnishing('paver', slot, fallback, 0, (model) => {
    // Reuse the authored smooth bevel and material as one bounded instance batch.
    // Keep its geometry shared; the assembly retains it until room cleanup.
    model.updateMatrixWorld(true);
    const inverse = model.matrixWorld.clone().invert(),
      batches = [];
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const batch = new THREE.InstancedMesh(mesh.geometry, mesh.material, rows * columns);
      batch.name = `${config.name} smooth paving`;
      batch.raycast = () => {};
      batch.castShadow = false;
      batch.receiveShadow = !phoneSafe;
      const source = inverse.clone().multiply(mesh.matrixWorld);
      const scale = new THREE.Matrix4().makeScale(
        (width - config.paverGap) / (0.985 * config.modelScale),
        1,
        (depth - config.paverGap) / (0.985 * config.modelScale),
      );
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const matrix = new THREE.Matrix4()
            .makeTranslation(
              (-rx + (column + 0.5) * width) / config.modelScale,
              0,
              (-rz + (row + 0.5) * depth) / config.modelScale,
            )
            .multiply(scale)
            .multiply(source);
          const index = row * columns + column;
          batch.setMatrixAt(index, matrix);
          batch.setColorAt(
            index,
            new THREE.Color(['#ffffff', '#eee8db', '#e6decf'][(row * 7 + column) % 3]),
          );
        }
      batches.push(batch);
    });
    model.clear();
    model.add(...batches);
  });
}
