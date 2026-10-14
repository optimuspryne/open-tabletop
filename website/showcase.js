// A progressive enhancement for the separately hosted static website.
const SLIDE_INTERVAL_MS = 6000;

function initShowcase(root) {
  const buttons = [...root.querySelectorAll('[data-showcase-slide]')];
  const pictures = [...root.querySelectorAll('.showcase-image')];
  const title = root.querySelector('[data-showcase-title]');
  const caption = root.querySelector('[data-showcase-caption]');
  const count = root.querySelector('[data-showcase-count]');
  const status = root.querySelector('[data-showcase-status]');
  const play = root.querySelector('[data-showcase-play]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let requested = 0;
  let active = 0;
  let request = 0;
  let timer;
  let loading = false;
  let playing = !motion.matches;
  let hovered = false;
  let focused = false;

  function schedule() {
    clearTimeout(timer);
    if (playing && !hovered && !focused && !document.hidden && !loading) {
      timer = setTimeout(() => show(current + 1), SLIDE_INTERVAL_MS);
    }
    const label = playing ? 'Pause slideshow' : 'Play slideshow';
    play.setAttribute('aria-label', label);
    play.title = label;
    play.querySelector('use').setAttribute('href', `#i-player-${playing ? 'pause' : 'play'}`);
  }

  async function show(index, manual = false) {
    requested = (index + buttons.length) % buttons.length;
    const target = requested;
    const ticket = ++request;
    if (manual) playing = false;
    loading = true;
    schedule();
    const slide = buttons[target].dataset;
    try {
      // Decode before swapping: a slow or missing asset must not blank the hero.
      const image = new Image();
      image.src = slide.src;
      await image.decode();
      if (ticket !== request) return;
      const incoming = pictures[1 - active];
      incoming.src = slide.src;
      await incoming.decode();
      if (ticket !== request) return;
      incoming.alt = slide.alt;
      incoming.removeAttribute('aria-hidden');
      incoming.classList.add('is-current');
      pictures[active].classList.remove('is-current');
      pictures[active].setAttribute('aria-hidden', 'true');
      pictures[active].alt = '';
      active = 1 - active;
      current = target;
      title.textContent = slide.title;
      caption.textContent = slide.caption;
      count.textContent = `${current + 1} / ${buttons.length}`;
      buttons.forEach((button, i) => {
        if (i === current) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
      status.textContent = manual
        ? `${slide.title}, slide ${current + 1} of ${buttons.length}.`
        : '';
    } catch {
      if (ticket !== request) return;
      requested = current;
      playing = false;
      status.textContent = `The ${slide.title} screenshot could not load. Choose another screenshot to continue.`;
    } finally {
      if (ticket === request) {
        loading = false;
        schedule();
      }
    }
  }

  root
    .querySelector('[data-showcase-prev]')
    .addEventListener('click', () => show(requested - 1, true));
  root
    .querySelector('[data-showcase-next]')
    .addEventListener('click', () => show(requested + 1, true));
  buttons.forEach((button, i) => button.addEventListener('click', () => show(i, true)));
  play.addEventListener('click', () => {
    playing = !playing;
    // Explicit Play resumes even while this control retains focus or the pointer.
    if (playing) {
      focused = false;
      hovered = false;
    }
    schedule();
  });
  root.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovered = true;
    schedule();
  });
  root.addEventListener('pointerleave', () => {
    hovered = false;
    schedule();
  });
  root.addEventListener('focusin', () => {
    focused = true;
    schedule();
  });
  root.addEventListener('focusout', (event) => {
    focused = root.contains(event.relatedTarget);
    schedule();
  });
  motion.addEventListener('change', () => {
    if (motion.matches) playing = false;
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  window.addEventListener('pageshow', schedule);
  root.querySelector('[data-showcase-controls]').hidden = false;
  schedule();
}

for (const root of document.querySelectorAll('[data-showcase]')) initShowcase(root);
