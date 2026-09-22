// Parse synchronized piece props defensively. A malformed legacy/custom payload should fall back
// to ordinary piece behavior instead of breaking input or the render loop.
export function piecePropsOf(piece) {
  try {
    const props = JSON.parse(piece?.props || '{}');
    return props && typeof props === 'object' && !Array.isArray(props) ? props : {};
  } catch {
    return {};
  }
}

export function pieceProperty(piece, name, fallback) {
  const props = piecePropsOf(piece);
  return Object.hasOwn(props, name) ? props[name] : fallback;
}

// Mesh-build props differ slightly from authored props for dispensers: their live count lives in
// its own schema field, while the stable id seeds the visible stack's facing jitter.
export function meshPropsOf(piece, id) {
  const props = piecePropsOf(piece);
  if (piece?.type === 'dispenser') {
    props.count = piece.count;
    props._seed = id;
  }
  return props;
}

export const snapshot = (time, piece) => ({
  t: time,
  x: piece.x,
  y: piece.y,
  z: piece.z,
  qx: piece.qx,
  qy: piece.qy,
  qz: piece.qz,
  qw: piece.qw,
});

export function applyTransform(mesh, transform) {
  mesh.position.set(transform.x, transform.y, transform.z);
  mesh.quaternion.set(transform.qx, transform.qy, transform.qz, transform.qw);
}

export function syncDeckMeshHeight(meshes, id, count, deckHeight) {
  const mesh = meshes.get(id)?.mesh;
  if (!mesh) return false;
  mesh.scale.y = deckHeight(count);
  return true;
}

export function createPieceView({
  scene,
  meshes,
  buffers,
  kinds,
  physics,
  deckHeight,
  createQuaternion,
  refreshCollider,
  isInspected,
}) {
  const qa = createQuaternion();
  const qb = createQuaternion();

  const configurePieceMesh = (mesh, id, castsShadow) => {
    mesh.traverse((node) => {
      node.userData.id = id;
      if (node.isMesh) {
        node.castShadow = castsShadow;
        node.receiveShadow = true;
      }
    });
  };

  const restoreBufferedTransform = (id, mesh) => {
    const buffer = buffers.get(id);
    const last = buffer && buffer[buffer.length - 1];
    if (last) applyTransform(mesh, last);
  };

  // Keep the shared lifecycle in one place while leaving type-specific construction and visual
  // policy explicit at each call site.
  const replaceMesh = (id, piece, { build, configure, afterBuild, hideWhenInspected = false }) => {
    const entry = meshes.get(id);
    if (!entry) return false;

    scene.remove(entry.mesh);
    const mesh = build();
    configure(mesh);
    if (afterBuild) afterBuild(mesh);
    restoreBufferedTransform(id, mesh);
    scene.add(mesh);
    entry.mesh = mesh;
    if (hideWhenInspected && isInspected(id)) mesh.visible = false;
    refreshCollider(id, piece);
    return true;
  };

  function rebuildCard(id, piece) {
    return replaceMesh(id, piece, {
      build: () => kinds.card.mesh(piecePropsOf(piece)),
      configure: (mesh) => {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.id = id;
      },
    });
  }

  function rebuildPiece(id, piece) {
    return replaceMesh(id, piece, {
      build: () => kinds[piece.type].mesh(meshPropsOf(piece, id)),
      configure: (mesh) => configurePieceMesh(mesh, id, physics[piece.type].mass > 0),
      hideWhenInspected: true,
    });
  }

  function rebuildDeck(id, piece) {
    const props = piecePropsOf(piece);
    return replaceMesh(id, piece, {
      build: () => kinds.deck.mesh(props),
      configure: (mesh) => configurePieceMesh(mesh, id, physics.deck.mass > 0),
      afterBuild: (mesh) => {
        if (!props.model) mesh.scale.y = deckHeight(piece.count);
      },
    });
  }

  // Position a mesh at renderTime by interpolating the two buffered snapshots around it. Before
  // the first or after the last snapshot, clamp to that endpoint.
  function sample(buffer, renderTime, mesh) {
    const count = buffer.length;
    if (!count) return false;
    if (count === 1 || renderTime <= buffer[0].t) {
      applyTransform(mesh, buffer[0]);
      return true;
    }
    if (renderTime >= buffer[count - 1].t) {
      applyTransform(mesh, buffer[count - 1]);
      return true;
    }

    let index = count - 2;
    while (index > 0 && buffer[index].t > renderTime) index--;
    const before = buffer[index];
    const after = buffer[index + 1];
    const fraction = (renderTime - before.t) / (after.t - before.t || 1);
    mesh.position.set(
      before.x + (after.x - before.x) * fraction,
      before.y + (after.y - before.y) * fraction,
      before.z + (after.z - before.z) * fraction,
    );
    qa.set(before.qx, before.qy, before.qz, before.qw);
    qb.set(after.qx, after.qy, after.qz, after.qw);
    mesh.quaternion.copy(qa).slerp(qb, fraction);
    return true;
  }

  return { rebuildCard, rebuildPiece, rebuildDeck, sample };
}
