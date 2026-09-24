import { PIECE_LABEL_LIMITS, finiteStockCount, lowStockText } from '../../shared/piece-labels.js';
import { piecePropsOf } from './piece-view.js';

const STYLE = { width: 2.8, lift: 0.35, pixels: 512, row: 64, margin: 16, font: 38 };

// Persistent tabletop annotations: the GM editor and labels share the same saved piece props.
export function createPieceLabels({ THREE, scene, meshes, getRoom, getRank, doc = document }) {
  const byId = (id) => doc.getElementById(id);
  const labels = new Map();
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  let editing = null;
  const modal = byId('pieceLabelsModal');
  const form = byId('pieceLabelsForm');
  const name = byId('pieceLabelText');
  const enabled = byId('pieceStockEnabled');
  const reference = byId('pieceStockReference');
  const percent = byId('pieceStockPercent');
  name.maxLength = PIECE_LABEL_LIMITS.text;
  reference.max = PIECE_LABEL_LIMITS.reference;
  const close = () => {
    modal.hidden = true;
    editing = null;
  };
  byId('pieceLabelsClose').onclick = close;
  byId('pieceLabelsCancel').onclick = close;
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  const syncFields = () => {
    reference.disabled = percent.disabled = !enabled.checked;
  };
  enabled.onchange = syncFields;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const room = getRoom();
    if (!editing || getRank() < 2 || !room?.state?.pieces?.has(editing)) return close();
    if (!form.reportValidity()) return;
    room.send('setPieceLabels', {
      id: editing,
      label: name.value,
      lowStock:
        !byId('pieceStockFields').hidden && enabled.checked
          ? { reference: Number(reference.value), percent: Number(percent.value) }
          : null,
    });
    close();
  });
  function edit(id) {
    const piece = getRoom()?.state?.pieces?.get(id);
    if (!piece || getRank() < 2) return;
    const props = piecePropsOf(piece);
    editing = id;
    name.value = props.label || '';
    byId('pieceStockFields').hidden = finiteStockCount(piece, props) === null;
    enabled.checked = !!props.lowStock;
    reference.value = props.lowStock?.reference || Math.max(1, piece.count || 1);
    percent.value = props.lowStock?.percent || 25;
    syncFields();
    modal.hidden = false;
  }
  function remove(id) {
    const entry = labels.get(id);
    if (!entry) return;
    scene.remove(entry.sprite);
    entry.sprite.material.map.dispose();
    entry.sprite.material.dispose();
    labels.delete(id);
  }
  function texture(label, stock) {
    const lines = [];
    let remaining = label;
    while (remaining.length) {
      let cut = Math.min(30, remaining.length);
      if (remaining.length > cut) {
        const space = remaining.lastIndexOf(' ', cut);
        if (space > 10) cut = space;
      }
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trim();
    }
    if (stock) lines.push(stock);
    const canvas = doc.createElement('canvas');
    canvas.width = STYLE.pixels;
    canvas.height = STYLE.row * lines.length + STYLE.margin * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(20,24,29,0.94)';
    ctx.beginPath();
    ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, STYLE.margin);
    ctx.fill();
    ctx.strokeStyle = stock ? '#ffd166' : '#b9c5cf';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = `bold ${STYLE.font}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, index) => {
      ctx.fillStyle = stock && index === lines.length - 1 ? '#ffd166' : '#e8e6e0';
      ctx.fillText(
        line,
        canvas.width / 2,
        STYLE.margin + STYLE.row * (index + 0.5),
        canvas.width - STYLE.margin * 2,
      );
    });
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    return result;
  }
  function update() {
    const pieces = getRoom()?.state?.pieces;
    if (editing && (!pieces?.has(editing) || getRank() < 2)) close();
    for (const id of labels.keys()) {
      if (!pieces?.has(id) || !meshes.get(id)?.mesh.visible) remove(id);
    }
    if (!pieces) return; // Room join can resolve before the initial synchronized state arrives.
    pieces.forEach((piece, id) => {
      const mesh = meshes.get(id)?.mesh;
      if (!mesh?.visible) return;
      const props = piecePropsOf(piece);
      const label =
        typeof props.label === 'string' ? props.label.slice(0, PIECE_LABEL_LIMITS.text) : '';
      const stock = lowStockText(piece, props);
      const key = JSON.stringify([label, stock]);
      if (!label && !stock) {
        remove(id);
        return;
      }
      let entry = labels.get(id);
      if (entry?.key !== key) {
        remove(id);
        const map = texture(label, stock);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false }),
        );
        sprite.scale.set(STYLE.width, (STYLE.width * map.image.height) / map.image.width, 1);
        sprite.renderOrder = 4;
        scene.add(sprite);
        entry = { sprite, key };
        labels.set(id, entry);
      }
      box.setFromObject(mesh);
      entry.sprite.visible = !box.isEmpty();
      if (box.isEmpty()) return;
      box.getCenter(center);
      entry.sprite.position.set(
        center.x,
        box.max.y + STYLE.lift + entry.sprite.scale.y / 2,
        center.z,
      );
    });
  }
  return { edit, update, remove };
}
