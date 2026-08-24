// Shared icon system for the lobby + admin pages. (client.js keeps its own copy for the table/editor.)
// The inline <symbol> sprite is injected into each page's HTML; these helpers reference it via <use>.
const NS = 'http://www.w3.org/2000/svg';

// Inject a Tabler icon (or several, space-separated in data-icon) into every button[data-icon],
// and copy its .lbl text into an aria-label so icon-only buttons stay screen-reader legible.
export function applyIcons(root = document) {
  root.querySelectorAll('button[data-icon]').forEach((btn) => {
    if (btn.querySelector('.ico')) return;
    btn.dataset.icon.trim().split(/\s+/).reverse().forEach((name) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'ico ico-' + name); svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS(NS, 'use'); use.setAttribute('href', '#i-' + name);
      svg.appendChild(use); btn.prepend(svg);
    });
    const lbl = btn.querySelector('.lbl');
    const txt = (btn.getAttribute('aria-label') || (lbl ? lbl.textContent : '') || btn.getAttribute('title') || '').trim();
    if (txt) btn.setAttribute('aria-label', txt);
    if (btn.hasAttribute('title')) btn.removeAttribute('title');
  });
}

// Replace an element's content with a single icon (for dynamic/state-changing icons). Idempotent.
export function setIcon(el, name) {
  if (!el || el._icon === name) return; el._icon = name;
  el.textContent = '';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ico ico-' + name); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use'); use.setAttribute('href', '#i-' + name);
  svg.appendChild(use); el.appendChild(svg);
}

// Snappy themed hover-hint for icon-only buttons (desktop mouse only) — reads the button's aria-label.
export function initTip() {
  const tip = document.createElement('div'); tip.id = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  let tipBtn = null, tipTimer = null;
  const place = (btn) => {
    tip.textContent = btn.getAttribute('aria-label') || ''; tip.hidden = false;
    const r = btn.getBoundingClientRect(), t = tip.getBoundingClientRect();
    let top = r.top - t.height - 8; if (top < 4) top = r.bottom + 8;
    const left = Math.max(4, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 4));
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  const hide = () => { tip.hidden = true; tipBtn = null; if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; } };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const btn = e.target.closest('button[aria-label]');
    if (!btn || !btn.querySelector('.ico') || btn === tipBtn) return;
    tipBtn = btn; clearTimeout(tipTimer); tipTimer = setTimeout(() => { if (tipBtn === btn) place(btn); }, 90);
  });
  document.addEventListener('pointerout', (e) => { if (e.pointerType !== 'mouse') return; const btn = e.target.closest('button[aria-label]'); if (btn && btn === tipBtn && !btn.contains(e.relatedTarget)) hide(); });
  document.addEventListener('pointerdown', hide, true);
}
