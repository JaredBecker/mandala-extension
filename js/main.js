// Bootstrap: load stored state, then wire up the mandala + every widget.
(async function () {
  const state = await MandalaStorage.load();

  // render-loader.js picks the WebGL or p5 renderer; wait until the chosen
  // sketch's globals (applyMandalaState etc.) exist before using them
  let activeRenderer = null;
  if (window.rendererReady){
    activeRenderer = await window.rendererReady.catch(() => null);
  }

  // the renderer preference is wired here (not in the sketches) because it
  // must work identically whichever renderer actually loaded
  const rendererSelect = document.getElementById('rendererSelect');
  const rendererHint = document.getElementById('rendererHint');
  rendererSelect.value = state.renderer || 'auto';
  if (activeRenderer){
    rendererHint.textContent = 'Now drawing with ' + (activeRenderer === 'webgl' ? 'WebGL.' : 'p5.js.');
  }
  rendererSelect.addEventListener('change', () => {
    MandalaStorage.patch('renderer', rendererSelect.value);
    rendererHint.textContent = 'Saved — takes effect on your next new tab.';
  });

  document.getElementById('howtoBtn').addEventListener('click', () => {
    document.getElementById('howtoBox').classList.toggle('open');
  });

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
