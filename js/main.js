// Bootstrap: load stored state, then wire up the mandala + every widget.
(async function () {
  const state = await MandalaStorage.load();

  document.getElementById('panel').classList.toggle('collapsed', state.panelCollapsed);

  applyMandalaState(state.mandala);
  if (typeof background === 'function' && typeof bgColourP5 !== 'undefined'){
    background(bgColourP5);
    if (typeof artLayer !== 'undefined' && artLayer){ artLayer.background(bgColourP5); }
    lastX = null; lastY = null;
  }

  MandalaWeather.init(state);
  MandalaGreeting.init(state);
  MandalaQuotes.init();
  MandalaTodo.init(state);
  MandalaLinks.init(state);
  MandalaSticky.init(state);
  MandalaFocusTimer.init(state);
  MandalaBreathing.init();
  MandalaWizard.init(state);
})();
