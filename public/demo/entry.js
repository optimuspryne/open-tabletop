import { applyIcons } from '../ui/icons.js';

const ACTIONS = {
  start: ['Start my table', 'Starting your table…'],
  resume: ['Resume my table', 'Resuming your table…'],
  invite: ['Join table', 'Joining the table…'],
};
const ERRORS = {
  capacity: 'The demo is full. Please try again shortly.',
  rate_limited: 'Please wait a moment before trying again.',
};

// Presentation only. The caller owns credentials, HTTP, navigation and server authority.
// Mount once per entry visit; dispose it when navigating or replacing the view.
export function mountDemoEntry(
  root,
  {
    mode = 'start',
    displayName = 'Guest',
    hostName = '',
    expiresAt = null,
    onSubmit,
    now = Date.now,
  } = {},
) {
  if (!Object.hasOwn(ACTIONS, mode)) throw new TypeError('Unknown demo entry mode.');
  if (typeof onSubmit !== 'function') throw new TypeError('Demo entry needs an action handler.');
  const lifetime = new AbortController();
  let currentMode = mode;
  let busy = false;
  let complete = false;
  let expired = false;
  let disposed = false;
  let retry = false;
  const deadline = expiresAt === null ? null : new Date(expiresAt).getTime();
  root.classList.add('demo-entry');
  root.innerHTML = `
    <section class="demo-entry__card panel" aria-labelledby="demo-heading">
      <header class="demo-entry__header">
        <span class="demo-entry__brand">Open Tabletop</span>
        <span class="demo-entry__badge">Public demo</span>
      </header>
      <div class="demo-entry__content">
        <h1 id="demo-heading" tabindex="-1">Your own table, ready to play</h1>
        <p data-demo="intro">Try it solo or invite friends. No account needed.</p>
        <p data-demo="remaining" hidden></p>
        <div class="demo-entry__columns">
          <form novalidate aria-label="Enter the public demo">
            <div data-demo="name-field" class="field-group">
              <label class="field-label" for="demo-name">Your name</label>
              <input id="demo-name" name="displayName" type="text" autocomplete="nickname"
                maxlength="20" required aria-describedby="demo-error">
            </div>
            <fieldset data-demo="starters">
              <legend>Choose a starting table</legend>
              <div class="demo-entry__choices">
                <label><input type="radio" name="starter" value="empty" checked>Empty table</label>
                <label><input type="radio" name="starter" value="dice">Dice</label>
                <label><input type="radio" name="starter" value="cards">Cards</label>
                <label><input type="radio" name="starter" value="chess">Chess</label>
              </div>
            </fieldset>
            <p id="demo-error" class="demo-entry__error" role="alert" tabindex="-1" hidden></p>
            <button class="button button--primary" type="submit" data-icon="player-play">
              <span class="lbl">Start my table</span>
            </button>
            <button data-demo="start-own" class="button" type="button" hidden>Start my own table</button>
            <p data-demo="status" role="status" aria-live="polite" aria-atomic="true"></p>
          </form>
        <p class="demo-entry__notice">Demo tables last up to 2 hours and are removed after 15 minutes empty.
          Demo progress is temporary.</p>
          <aside data-demo="aside" class="demo-entry__aside">
            <h2>Have an invite?</h2>
            <p>Open the link your host shared. You'll join their table as a player.</p>
          </aside>
        </div>

      </div>
    </section>`;
  const find = (name) => root.querySelector(`[data-demo="${name}"]`);
  const form = root.querySelector('form');
  const name = root.querySelector('#demo-name');
  const heading = root.querySelector('h1');
  const submit = root.querySelector('[type="submit"]');
  const error = root.querySelector('#demo-error');
  name.value = typeof displayName === 'string' ? displayName.slice(0, 20) : 'Guest';
  applyIcons(root);

  function showError(message, focus = true) {
    error.textContent = message;
    error.hidden = false;
    if (focus) error.focus();
  }

  function render() {
    const label = busy ? ACTIONS[currentMode][1] : retry ? 'Try again' : ACTIONS[currentMode][0];
    submit.querySelector('.lbl').textContent = label;
    submit.setAttribute('aria-label', label);
    submit.disabled = busy || complete || expired;
    submit.hidden = expired;
    form.setAttribute('aria-busy', String(busy));
    name.disabled = busy || complete;
    find('starters').disabled = busy || complete;
    find('starters').hidden = currentMode !== 'start' || expired;
    find('name-field').hidden = currentMode === 'resume' || expired;
    find('aside').hidden = currentMode !== 'start';
    find('start-own').hidden = !expired;
    find('start-own').disabled = busy;
    heading.textContent =
      currentMode === 'invite'
        ? hostName
          ? `Join ${hostName}'s table`
          : 'Join your friend’s table'
        : currentMode === 'resume'
          ? 'Your table is ready'
          : 'Your own table, ready to play';
    find('intro').textContent =
      currentMode === 'invite'
        ? 'Enter your name to join as a player.'
        : currentMode === 'resume'
          ? 'Pick up where you left off.'
          : 'Try it solo or invite friends. No account needed.';
    find('status').textContent = busy ? ACTIONS[currentMode][1] : '';
  }

  function markExpired(focus) {
    expired = true;
    retry = false;
    find('remaining').hidden = true;
    render();
    showError(
      currentMode === 'invite' ? 'This invite has expired.' : 'This table has expired.',
      focus,
    );
  }

  function updateRemaining() {
    if (disposed || currentMode === 'start' || expired || deadline === null) return;
    const left = deadline - now();
    if (!Number.isFinite(left) || left <= 0) {
      // Do not move keyboard focus asynchronously as the countdown runs out.
      markExpired(false);
      return;
    }
    const minutes = Math.ceil(left / 60000);
    find('remaining').hidden = false;
    find('remaining').textContent =
      `${minutes >= 60 ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m remaining`;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    updateRemaining();
    if (busy || complete || expired || disposed) return;
    const displayName = name.value.trim();
    if (
      currentMode !== 'resume' &&
      (!displayName || displayName.length > 20 || /[\x00-\x1f\x7f]/.test(displayName))
    ) {
      name.setAttribute('aria-invalid', 'true');
      showError('Enter a name using 1–20 printable characters.', false);
      name.focus();
      return;
    }
    name.removeAttribute('aria-invalid');
    error.hidden = true;
    busy = true;
    render();
    try {
      await onSubmit(
        {
          action: currentMode,
          ...(currentMode !== 'resume' ? { displayName } : {}),
          ...(currentMode === 'start' ? { starter: form.elements.starter.value } : {}),
        },
        { signal: lifetime.signal },
      );
      if (disposed) return;
      busy = false;
      updateRemaining();
      if (expired) {
        render();
        return;
      }
      complete = true;
      render();
      find('status').textContent = 'Your table is ready.';
    } catch (cause) {
      if (disposed) return;
      busy = false;
      if (cause?.code === 'expired') return markExpired(true);
      retry = true;
      render();
      // Never print server error strings, URLs or credentials into this screen.
      showError(ERRORS[cause?.code] || 'We couldn’t open your table. Please try again.');
    }
  }

  form.addEventListener('submit', handleSubmit, { signal: lifetime.signal });
  find('start-own').addEventListener(
    'click',
    () => {
      if (busy || disposed) return;
      currentMode = 'start';
      expired = false;
      retry = false;
      complete = false;
      error.hidden = true;
      render();
      heading.focus();
    },
    { signal: lifetime.signal },
  );
  render();
  updateRemaining();
  const timer = setInterval(updateRemaining, 30000);
  return {
    destroy() {
      disposed = true;
      lifetime.abort();
      clearInterval(timer);
      root.replaceChildren();
      root.classList.remove('demo-entry');
    },
  };
}
