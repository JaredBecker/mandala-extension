// Custom tooltips for anything carrying a data-tip attribute — one shared
// bubble instead of the browser's plain title popup, so it matches the
// panel's glass styling. Listeners are delegated on the document, so
// dynamically created controls (custom-palette swatches, user preset rows,
// weather dots, quick links) get tooltips for free.
(function () {
  const tip = document.createElement('div');
  tip.id = 'tooltip';
  document.body.appendChild(tip);

  const SHOW_DELAY = 350; // hover pause before the first tooltip appears
  let current = null;     // element the visible/pending tooltip belongs to
  let showTimer = null;

  function hide(){
    clearTimeout(showTimer);
    showTimer = null;
    current = null;
    tip.classList.remove('show');
  }

  // Preferred spot is beside the control (the panel hugs the right edge, so
  // "left" points tips into open canvas instead of covering neighbouring
  // controls), falling back to right/above/below when there's no room.
  // The arrow keeps pointing at the control even when the bubble is clamped
  // to the viewport edge, via the --ax/--ay custom properties.
  function place(el){
    const r = el.getBoundingClientRect();
    const gap = 10, pad = 8;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    let side, x, y;
    if (r.left - gap - tw >= pad){
      side = 'left';
      x = r.left - gap - tw;
      y = clamp(r.top + r.height / 2 - th / 2, pad, vh - th - pad);
    } else if (r.right + gap + tw <= vw - pad){
      side = 'right';
      x = r.right + gap;
      y = clamp(r.top + r.height / 2 - th / 2, pad, vh - th - pad);
    } else if (r.top - gap - th >= pad){
      side = 'top';
      y = r.top - gap - th;
      x = clamp(r.left + r.width / 2 - tw / 2, pad, vw - tw - pad);
    } else {
      side = 'bottom';
      y = Math.min(r.bottom + gap, vh - th - pad);
      x = clamp(r.left + r.width / 2 - tw / 2, pad, vw - tw - pad);
    }

    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.style.setProperty('--ay', clamp(r.top + r.height / 2 - y, 12, th - 12) + 'px');
    tip.style.setProperty('--ax', clamp(r.left + r.width / 2 - x, 12, tw - 12) + 'px');
    tip.classList.remove('tip-left', 'tip-right', 'tip-top', 'tip-bottom');
    tip.classList.add('tip-' + side);
  }

  function show(el){
    current = el;
    tip.textContent = el.dataset.tip;
    place(el);
    tip.classList.add('show');
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el){ hide(); return; }
    if (el === current) return;
    // moving between two tipped controls skips the delay, like native menus
    const wasVisible = tip.classList.contains('show');
    hide();
    if (wasVisible) show(el);
    else showTimer = setTimeout(() => show(el), SHOW_DELAY);
  });

  // mouse left the window entirely — no mouseover will fire to clean up
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) hide(); });

  // clicks flip state (tabs, checkboxes) and drags move sliders under the
  // bubble; typing/zen-mode/tabbing all start with a key — just get out of
  // the way, the next hover brings it back
  document.addEventListener('mousedown', hide);
  document.addEventListener('keydown', hide);
  document.addEventListener('scroll', hide, true); // capture: the panel scrolls, not the page

  // keyboard navigation gets the same tooltips, without the hover delay.
  // :focus-visible keeps mouse clicks (slider drags, select opens) from
  // popping the bubble — only Tab-style focus counts
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el && el !== current && e.target.matches(':focus-visible')) { hide(); show(el); }
  });
  document.addEventListener('focusout', hide);
})();
