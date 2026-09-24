// Apply the saved compact/full interface preference on every page.
// (External file so it isn't blocked by the inline-script CSP; runs before the module scripts.)
try {
  document.body.classList.toggle('ui-full', localStorage.getItem('ott-ui-full') !== '0');
} catch (e) {}

try {
  var a = localStorage.getItem('ott-accent');
  if (a && /^#[0-9a-f]{6}$/i.test(a)) {
    var s = document.documentElement.style;
    s.setProperty('--accent', a);
    s.setProperty(
      '--accent-soft',
      'rgba(' +
        parseInt(a.slice(1, 3), 16) +
        ',' +
        parseInt(a.slice(3, 5), 16) +
        ',' +
        parseInt(a.slice(5, 7), 16) +
        ',.25)',
    );
  }
} catch (e) {}

// Equalize button widths within every compact action group to the group's widest
// button, so grouped actions render as a tidy, aligned set (CSS min-width gives
// a floor; this matches the rest up to the widest). Runs on load, on resize
// (the fluid font rescales widths), and whenever the DOM changes (re-renders).
(function () {
  let queued = false;
  function run() {
    queued = false;
    const groups = [...document.querySelectorAll('.button-row--compact')]
      .map((group) => [...group.querySelectorAll(':scope > button')])
      .filter((buttons) => buttons.length >= 2);
    // Reset every group before measuring any: alternating writes/reads per library card
    // forces a full layout for each row. These three phases need only one measurement layout.
    for (const buttons of groups) for (const button of buttons) button.style.width = '';
    const widths = groups.map((buttons) =>
      Math.ceil(Math.max(...buttons.map((button) => button.getBoundingClientRect().width))),
    );
    groups.forEach((buttons, index) => {
      if (!widths[index]) return; // hidden — retain natural widths until the panel opens
      for (const button of buttons) button.style.width = widths[index] + 'px';
    });
  }
  function schedule() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(run);
    }
  }
  // childList catches re-renders; the `hidden` filter catches a panel/modal opening
  // (its buttons finally have a measurable width). Setting style.width is a `style`
  // attribute change, not `hidden`, so this never re-triggers itself.
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  addEventListener('load', schedule);
  addEventListener('resize', schedule);
})();
