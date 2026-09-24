import { dispenserDefinition } from './pieces.js';

export const PIECE_LABEL_LIMITS = Object.freeze({ text: 60, reference: 100000 });

// Labels describe the table object, not the individual cards/items inside it.
export function normalizePieceLabels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.label !== 'string' || value.label.length > PIECE_LABEL_LIMITS.text) return null;
  const label = value.label.replace(/\s+/g, ' ').trim();
  let lowStock = null;
  if (value.lowStock !== null) {
    const config = value.lowStock;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
    if (Object.keys(config).some((key) => key !== 'reference' && key !== 'percent')) return null;
    if (
      !Number.isSafeInteger(config.reference) ||
      config.reference < 1 ||
      config.reference > PIECE_LABEL_LIMITS.reference
    )
      return null;
    if (!Number.isSafeInteger(config.percent) || config.percent < 1 || config.percent > 100)
      return null;
    lowStock = { reference: config.reference, percent: config.percent };
  }
  return { label, lowStock };
}

export function finiteStockCount(piece, props) {
  if (piece.type !== 'deck') {
    const definition = dispenserDefinition(props);
    if (piece.type !== 'dispenser' || !definition || definition.infinite) return null;
  }
  return Number.isSafeInteger(piece.count) && piece.count >= 0 ? piece.count : null;
}

export function lowStockText(piece, props) {
  if (!props.lowStock) return '';
  const count = finiteStockCount(piece, props);
  const settings = normalizePieceLabels({ label: '', lowStock: props.lowStock ?? null });
  const config = settings?.lowStock;
  if (count === null || !config || count * 100 >= config.reference * config.percent) return '';
  const noun = piece.type === 'deck' ? (props.tile ? 'tiles' : 'cards') : 'pieces';
  return `${count} ${noun} left`;
}
