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

  // "How it works" opens one shared modal from either tab; click-outside,
  // the close button, or Escape dismiss it
  const howtoOverlay = document.getElementById('howto-overlay');
  const openHowto = () => howtoOverlay.classList.add('open');
  const closeHowto = () => howtoOverlay.classList.remove('open');
  document.getElementById('howtoBtn').addEventListener('click', openHowto);
  document.getElementById('howtoBtnAmbient').addEventListener('click', openHowto);
  document.getElementById('howtoClose').addEventListener('click', closeHowto);
  howtoOverlay.addEventListener('click', (e) => { if (e.target === howtoOverlay) closeHowto(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHowto(); });

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

  // every control registers a refresher that re-reads `ambient`, so the
  // whole tab can re-sync after a reset-to-defaults
  const ambientRefreshers = [];
  const syncAmbientUI = () => ambientRefreshers.forEach((f) => f());

  [['ambSymmetry', 'symmetry'], ['ambBrush', 'brush'],
   ['ambPulse', 'pulseBrush'], ['ambColours', 'colours'], ['ambGlow', 'glow'],
   ['ambAlpha', 'strokeAlpha'], ['ambRotation', 'rotation'], ['ambReact', 'reactToSpeed'],
   ['ambSparkle', 'sparkleDust'], ['ambTrails', 'trails']].forEach(([id, key]) => {
    const el = $id(id);
    ambientRefreshers.push(() => { el.checked = ambient.randomize[key]; });
    el.addEventListener('change', () => { ambient.randomize[key] = el.checked; pushAmbient(); });
  });

  // gallery mode: ambient builds a piece, dissolves it, and starts a new one
  const galleryCb = $id('ambGallery');
  const gallerySec = $id('ambGallerySec');
  const syncGallery = () => {
    galleryCb.checked = !!ambient.gallery;
    gallerySec.value = ambient.gallerySeconds || 45;
    $id('ambGallerySecVal').textContent = (ambient.gallerySeconds || 45) + 's';
    $id('galleryGroup').style.display = ambient.gallery ? 'block' : 'none';
  };
  ambientRefreshers.push(syncGallery);
  galleryCb.addEventListener('change', () => { ambient.gallery = galleryCb.checked; syncGallery(); pushAmbient(); });
  gallerySec.addEventListener('input', () => {
    ambient.gallerySeconds = parseInt(gallerySec.value, 10);
    $id('ambGallerySecVal').textContent = ambient.gallerySeconds + 's';
    pushAmbient();
  });

  document.querySelectorAll('#tab-ambient [data-style]').forEach((cb) => {
    ambientRefreshers.push(() => { cb.checked = ambient.styles.includes(cb.dataset.style); });
    cb.addEventListener('change', () => {
      ambient.styles = [...document.querySelectorAll('#tab-ambient [data-style]:checked')]
        .map((c) => c.dataset.style);
      pushAmbient();
    });
  });

  // symmetry geometries the shuffle may pick — same pool semantics as the
  // stroke styles above (untick all = keep the user's own geometry)
  document.querySelectorAll('#tab-ambient [data-symmode]').forEach((cb) => {
    ambientRefreshers.push(() => { cb.checked = (ambient.symModes || []).includes(cb.dataset.symmode); });
    cb.addEventListener('change', () => {
      ambient.symModes = [...document.querySelectorAll('#tab-ambient [data-symmode]:checked')]
        .map((c) => c.dataset.symmode);
      pushAmbient();
    });
  });

  // min/max pairs — dragging one past the other drags its partner along
  const bindRangePair = (minId, maxId, minKey, maxKey) => {
    const lo = $id(minId), hi = $id(maxId);
    const loVal = $id(minId + 'Val'), hiVal = $id(maxId + 'Val');
    const refresh = () => {
      lo.value = ambient[minKey]; hi.value = ambient[maxKey];
      loVal.textContent = ambient[minKey]; hiVal.textContent = ambient[maxKey];
    };
    ambientRefreshers.push(refresh);
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
    ambientRefreshers.push(() => { cb.checked = ambient.patterns.includes(cb.dataset.pattern); });
    cb.addEventListener('change', () => {
      ambient.patterns = [...document.querySelectorAll('#tab-ambient [data-pattern]:checked')]
        .map((c) => c.dataset.pattern);
      pushAmbient();
    });
  });
  syncAmbientUI();

  // ---- reset everything (art + ambient) back to factory defaults ----
  document.getElementById('resetDefaultsBtn').addEventListener('click', () => {
    const defaults = MandalaStorage.DEFAULT_STATE;
    const dm = JSON.parse(JSON.stringify(defaults.mandala));
    if (typeof applyMandalaState === 'function') applyMandalaState(dm);
    MandalaStorage.patch('mandala', dm);

    const da = JSON.parse(JSON.stringify(defaults.ambient));
    Object.keys(ambient).forEach((k) => { delete ambient[k]; });
    Object.assign(ambient, da);
    syncAmbientUI();
    pushAmbient();
  });

  // ---- user preset slots: save the current look, apply it later ----
  // full mandala-state snapshots, applied through the same path storage
  // loads take — the renderers expose getMandalaState for the capture
  let userPresets = Array.isArray(state.userPresets) ? state.userPresets : [];
  const presetRows = document.getElementById('userPresetRows');
  const savePresetBtn = document.getElementById('savePresetBtn');
  const savePresetForm = document.getElementById('savePresetForm');
  const presetNameInput = document.getElementById('presetNameInput');

  const applyFullConfig = (cfg) => {
    // merge over the live state so presets saved before newer settings
    // existed still apply cleanly
    const merged = MandalaStorage.deepMerge(window.getMandalaState(), cfg);
    applyMandalaState(merged);
    MandalaStorage.patch('mandala', merged);
  };

  const renderUserPresets = () => {
    presetRows.textContent = '';
    userPresets.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'button-row preset-user-row';
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.dataset.tip = 'Your saved look — click to apply it';
      btn.addEventListener('click', () => applyFullConfig(p.config));
      const del = document.createElement('button');
      del.className = 'preset-del';
      del.textContent = '×';
      del.dataset.tip = 'Delete this preset';
      del.addEventListener('click', () => {
        userPresets.splice(i, 1);
        MandalaStorage.patch('userPresets', userPresets);
        renderUserPresets();
      });
      row.appendChild(btn);
      row.appendChild(del);
      presetRows.appendChild(row);
    });
    savePresetBtn.parentElement.style.display = userPresets.length >= 6 ? 'none' : 'flex';
  };
  renderUserPresets();

  savePresetBtn.addEventListener('click', () => {
    savePresetForm.style.display = 'flex';
    savePresetBtn.parentElement.style.display = 'none';
    presetNameInput.focus();
  });
  savePresetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = presetNameInput.value.trim() || ('My look ' + (userPresets.length + 1));
    userPresets.push({ name, config: window.getMandalaState() });
    MandalaStorage.patch('userPresets', userPresets);
    presetNameInput.value = '';
    savePresetForm.style.display = 'none';
    renderUserPresets();
  });

  // ---- Today's mandala: a date-seeded look, identical for everyone ----
  document.getElementById('presetDaily').addEventListener('click', () => {
    const d = new Date();
    let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    // mulberry32 — tiny deterministic PRNG, so the same date always rolls
    // the same look on every machine
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    applyFullConfig({
      symmetry: 6 + Math.floor(rnd() * 21),
      mirror: true,
      symmetryMode: pick(['radial', 'radial', 'kaleido', 'spiral']),
      strokeStyleMode: pick(['line', 'ribbon', 'dots', 'sparkle', 'rails', 'rings', 'petals', 'taper', 'chalk', 'dashed', 'silk']),
      colourMode: pick(['rainbow', 'gradient']),
      palette: pick(['full', 'sunset', 'ocean', 'forest', 'mono']),
      brushSize: 2 + Math.floor(rnd() * 9),
      glowIntensity: Math.floor(rnd() * 22),
      strokeAlpha: 60 + Math.floor(rnd() * 41),
      rainbowSpeed: Math.round((0.3 + rnd() * 1.2) * 10) / 10,
      pulseBrush: rnd() > 0.6,
      sparkleDust: rnd() > 0.75,
      reactToSpeed: false,
      autoRotate: rnd() > 0.4,
      rotateSpeed: Math.round((0.05 + rnd() * 0.2) * 100) / 100,
      trailMode: pick(['fade', 'fade', 'permanent', 'cycle']),
      fadeSpeed: 3 + Math.floor(rnd() * 10)
    });
  });

  // ---- share: export/import the current look and the ambient settings ----
  // exports are small tagged-JSON blobs meant to be pasted to a friend; the
  // tag stops a look landing in the ambient importer and vice versa. Import
  // filters to known keys so shared junk can't accumulate in storage.
  const wireShare = (ids, kind, kindLabel, otherTabLabel, getConfig, applyConfig) => {
    const exportBtn = $id(ids.exp), importBtn = $id(ids.imp);
    const form = $id(ids.form), text = $id(ids.text), msg = $id(ids.msg);

    exportBtn.addEventListener('click', async () => {
      const payload = JSON.stringify({ kind, version: 1, config: getConfig() });
      try {
        await navigator.clipboard.writeText(payload);
        const orig = exportBtn.textContent;
        exportBtn.textContent = 'Copied!';
        setTimeout(() => { exportBtn.textContent = orig; }, 1400);
      } catch (e) {
        // clipboard can be unavailable — show the JSON for manual copying
        form.style.display = 'block';
        text.value = payload;
        text.select();
        msg.textContent = 'Clipboard unavailable — copy the text above by hand.';
      }
    });

    importBtn.addEventListener('click', () => {
      const open = form.style.display !== 'none';
      form.style.display = open ? 'none' : 'block';
      msg.textContent = '';
      if (!open){ text.value = ''; text.focus(); }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let parsed;
      try {
        parsed = JSON.parse(text.value.trim());
      } catch (err) {
        msg.textContent = "That doesn't look like a valid share — copy the whole text and try again.";
        return;
      }
      if (parsed && parsed.kind && parsed.kind !== kind){
        msg.textContent = `That's ${otherTabLabel} — paste it there instead.`;
        return;
      }
      const config = parsed && parsed.kind ? parsed.config : parsed;
      if (!config || typeof config !== 'object' || Array.isArray(config)){
        msg.textContent = "That doesn't look like " + kindLabel + '.';
        return;
      }
      applyConfig(config);
      msg.textContent = 'Applied ✓';
      text.value = '';
      setTimeout(() => { form.style.display = 'none'; msg.textContent = ''; }, 1200);
    });
  };

  // only keys the app actually knows survive an import
  const pickKnown = (defaults, cfg) => {
    const clean = {};
    Object.keys(defaults).forEach((k) => { if (cfg[k] !== undefined) clean[k] = cfg[k]; });
    return clean;
  };

  wireShare(
    { exp: 'exportLookBtn', imp: 'importLookBtn', form: 'importLookForm', text: 'importLookText', msg: 'importLookMsg' },
    'mandala-look', 'a mandala look', 'an Ambient-settings share (Ambient tab)',
    () => window.getMandalaState(),
    (cfg) => applyFullConfig(pickKnown(MandalaStorage.DEFAULT_STATE.mandala, cfg))
  );

  wireShare(
    { exp: 'exportAmbientBtn', imp: 'importAmbientBtn', form: 'importAmbientForm', text: 'importAmbientText', msg: 'importAmbientMsg' },
    'mandala-ambient', 'ambient settings', 'a look share (Customize tab)',
    () => JSON.parse(JSON.stringify(ambient)),
    (cfg) => {
      const defaults = JSON.parse(JSON.stringify(MandalaStorage.DEFAULT_STATE.ambient));
      const merged = MandalaStorage.deepMerge(defaults, pickKnown(defaults, cfg));
      Object.keys(ambient).forEach((k) => { delete ambient[k]; });
      Object.assign(ambient, merged);
      syncAmbientUI();
      pushAmbient();
    }
  );

  // ---- keyboard shortcuts ----
  // H = zen mode (hide all UI), S = save PNG, C = clear, R = surprise me.
  // Routed through the existing buttons so both renderers just work.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    // swallow keys only where typing (or letter-jumping, for selects) means
    // something — clicking a checkbox/slider/color well leaves it focused,
    // and shortcuts should still work right after adjusting one
    const TYPING_INPUTS = ['text', 'number', 'search', 'email', 'password', 'url', 'tel'];
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ||
        (t.tagName === 'INPUT' && TYPING_INPUTS.includes(t.type)))) return;
    const k = e.key.toLowerCase();
    if (k === 'h') document.body.classList.toggle('zen');
    else if (k === 's') document.getElementById('saveBtn').click();
    else if (k === 'c') document.getElementById('clearBtn').click();
    else if (k === 'r') document.getElementById('randomBtn').click();
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
  MandalaQuotes.init(state);
  MandalaTodo.init(state);
  MandalaLinks.init(state);
  MandalaSticky.init(state);
  MandalaFocusTimer.init(state);
  MandalaBreathing.init();
  MandalaWizard.init(state);
})();
