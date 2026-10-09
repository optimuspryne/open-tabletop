import {
  OBJECT_FINISHES,
  DICE_FINISH_FALLBACK,
  tileAppearanceOf,
  tileModelFamily,
} from '../../shared/pieces.js';

// Inspector and selection share labeled controls. Patches change only one slot; choosing a
// base never auto-contrasts the inset. Native color inputs support mouse, keyboard and touch.
export function createTileAppearanceControls(
  container,
  { onChange, doc = document, deviceClass = () => 'desktop' } = {},
) {
  if (!container) return null;
  container.classList.add('domino-appearance');
  const colors = doc.createElement('div');
  colors.className = 'domino-appearance__colors';
  const controls = {};
  for (const key of ['base', 'inset', 'finish']) {
    const label = doc.createElement('label');
    const text = doc.createElement('span');
    const input = doc.createElement(key === 'finish' ? 'select' : 'input');
    input.id = container.id + '-' + key;
    label.htmlFor = input.id;
    input.className = key === 'finish' ? 'control control--select' : 'control';

    if (key === 'finish') {
      for (const f of [{ key: 'original', name: 'Original (GLB)' }, ...OBJECT_FINISHES]) {
        if (deviceClass() === 'phone' && DICE_FINISH_FALLBACK[f.key]) continue;
        const option = doc.createElement('option');
        option.value = f.key;
        option.textContent = f.name;
        input.appendChild(option);
      }
    } else input.type = 'color';
    const change = (event) =>
      onChange?.(
        {
          [key]: key === 'finish' ? input.value : parseInt(input.value.slice(1), 16),
        },
        event.type === 'change',
      );
    input.addEventListener('input', change);
    input.addEventListener('change', change);
    label.append(text, input);
    if (key === 'finish') container.appendChild(label);
    else colors.appendChild(label);
    controls[key] = { input, text };
  }
  container.prepend(colors);
  return {
    setProps(props, others = []) {
      const family = tileModelFamily(props);
      if (!family) return;
      const appearance = tileAppearanceOf(props);
      for (const [key, { input, text }] of Object.entries(controls)) {
        input.setAttribute(
          'aria-label',
          family.name + ' ' + (key === 'finish' ? 'material' : key + ' color'),
        );
        const mixed = others.some((p) => tileAppearanceOf(p)?.[key] !== appearance[key]);
        text.textContent =
          (key === 'finish' ? 'Material' : key === 'base' ? 'Base' : 'Inset') +
          (mixed ? ' (mixed)' : '');
        if (doc.activeElement === input) continue;
        input.value =
          key === 'finish'
            ? deviceClass() === 'phone'
              ? DICE_FINISH_FALLBACK[appearance[key]] || appearance[key]
              : appearance[key]
            : '#' + appearance[key].toString(16).padStart(6, '0');
      }
    },
  };
}
