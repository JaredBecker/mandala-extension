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

  // ---- Ambient tab: what auto-draw may randomize ----
  // wired here (not in the sketches) because it's renderer-agnostic; the
  // active sketch receives the live config through applyAmbientState
  const ambient = state.ambient;
  const $id = (id) => document.getElementById(id);
  const pushAmbient = () => {
    if (typeof applyAmbientState === 'function') applyAmbientState(ambient);
    MandalaStorage.patch('ambient', ambient);
  };
  if (typeof applyAmbientState === 'function') applyAmbientState(ambient);

  [['ambSymmetry', 'symmetry'], ['ambBrush', 'brush'], ['ambStrokeStyle', 'strokeStyle'],
   ['ambPulse', 'pulseBrush'], ['ambColours', 'colours'], ['ambGlow', 'glow'],
   ['ambAlpha', 'strokeAlpha'], ['ambRotation', 'rotation'], ['ambReact', 'reactToSpeed'],
   ['ambSparkle', 'sparkleDust'], ['ambTrails', 'trails']].forEach(([id, key]) => {
    const el = $id(id);
    el.checked = ambient.randomize[key];
    el.addEventListener('change', () => { ambient.randomize[key] = el.checked; pushAmbient(); });
  });

  // min/max pairs — dragging one past the other drags its partner along
  const bindRangePair = (minId, maxId, minKey, maxKey) => {
    const lo = $id(minId), hi = $id(maxId);
    const loVal = $id(minId + 'Val'), hiVal = $id(maxId + 'Val');
    const refresh = () => {
      lo.value = ambient[minKey]; hi.value = ambient[maxKey];
      loVal.textContent = ambient[minKey]; hiVal.textContent = ambient[maxKey];
    };
    refresh();
    lo.addEventListener('input', () => {
      ambient[minKey] = parseInt(lo.value, 10);
      if (ambient[minKey] > ambient[maxKey]) ambient[maxKey] = ambient[minKey];
      refresh(); pushAmbient();
    });
    hi.addEventListener('input', () => {
      ambient[maxKey] = parseInt(hi.value, 10);
      if (ambient[maxKey] < ambient[minKey]) ambient[minKey] = ambient[maxKey];
      refresh(); pushAmbient();
    });
  };
  bindRangePair('ambSymMin', 'ambSymMax', 'symmetryMin', 'symmetryMax');
  bindRangePair('ambBrushMin', 'ambBrushMax', 'brushMin', 'brushMax');
  bindRangePair('ambGlowMin', 'ambGlowMax', 'glowMin', 'glowMax');

  document.querySelectorAll('#tab-ambient [data-pattern]').forEach((cb) => {
    cb.checked = ambient.patterns.includes(cb.dataset.pattern);
    cb.addEventListener('change', () => {
      ambient.patterns = [...document.querySelectorAll('#tab-ambient [data-pattern]:checked')]
        .map((c) => c.dataset.pattern);
      pushAmbient();
    });
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
