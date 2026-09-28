// Shared button DOM only. Callers own icon mappings, accessible labels and action policy.
// Omit type to retain the legacy row factory's attribute behavior.
export function makeButton(label, fn, cls, icon, { type } = {}) {
  const button = document.createElement('button');
  if (type) button.type = type;
  button.className = ['button', cls === 'danger' ? 'button--danger' : cls]
    .filter(Boolean)
    .join(' ');
  if (icon) {
    button.dataset.icon = icon;
    const text = document.createElement('span');
    text.className = 'lbl';
    text.textContent = label;
    button.appendChild(text);
  } else button.textContent = label;
  button.onclick = fn;
  return button;
}
