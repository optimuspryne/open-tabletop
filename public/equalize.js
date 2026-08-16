// Equalize button widths within every `.actions` group to the group's widest
// button, so grouped actions render as a tidy, aligned set (CSS min-width gives
// a floor; this matches the rest up to the widest). Runs on load, on resize
// (the fluid font rescales widths), and whenever the DOM changes (re-renders).
(function () {
  function equalizeGroup(group) {
    const btns = group.querySelectorAll(':scope > button');
    if (btns.length < 2) return;
    for (const b of btns) b.style.width = '';                       // reset to natural width
    let max = 0;
    for (const b of btns) max = Math.max(max, b.getBoundingClientRect().width);
    if (!max) return;                                               // hidden / not laid out yet — leave natural, don't collapse to 0
    max = Math.ceil(max);
    for (const b of btns) b.style.width = max + 'px';               // unify to the widest
  }
  let queued = false;
  function run() { queued = false; document.querySelectorAll('.actions').forEach(equalizeGroup); }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(run); } }
  // childList catches re-renders; the `hidden` filter catches a panel/modal opening
  // (its buttons finally have a measurable width). Setting style.width is a `style`
  // attribute change, not `hidden`, so this never re-triggers itself.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  addEventListener('load', schedule);
  addEventListener('resize', schedule);
})();
