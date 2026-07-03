// Promise-based wrapper around browser.storage.local, one JSON blob keyed "state".
(function () {
  const DEFAULT_STATE = {
    profile: { name: '', onboarded: false },
    locations: [],
    activeLocationId: null,
    mandala: {
      symmetry: 12, mirror: true, brushSize: 3, reactToSpeed: true,
      colourMode: 'rainbow', solidColourHex: '#ff3e94', trailMode: 'fade',
      fadeSpeed: 8, bgColourHex: '#0a0a0a', palette: 'full', glowIntensity: 10,
      pulseBrush: false, strokeStyleMode: 'line', autoRotate: true,
      rotateSpeed: 0.15, sparkleDust: false, idleDraw: true,
      strokeAlpha: 92,        // stroke opacity, p5's 0-100 alpha scale
      rainbowSpeed: 0.7,      // hue-cycle rate in rainbow colour mode
      idlePace: 100,          // % multiplier on ambient drawing speed
      idleShuffleSeconds: 10, // how often ambient drawing restyles itself
      // off by default — running two idle pens roughly doubles idle-draw
      // cost, fine on capable hardware but not something to force on
      // everyone's machine
      doubleIdlePattern: false,
      cycleBuildSeconds: 60,
      // Depth is WebGL-only: perspective tilt strength (0 = flat classic
      // look) and whether the camera drifts ambiently. Ignored by the p5
      // renderer.
      depthAmount: 30,
      depthDrift: true
    },
    // 'auto' = WebGL with p5 fallback; 'p5' = always the classic canvas
    // renderer. Read by render-loader.js before either sketch is loaded.
    renderer: 'auto',
    // what ambient (auto-draw) mode may randomize: anything switched off in
    // `randomize` keeps the user's own setting; numeric limits bound the
    // rolls; `patterns` is the pool of idle path algorithms it may pick
    ambient: {
      randomize: {
        symmetry: true, brush: true, strokeStyle: true, pulseBrush: true,
        colours: true, glow: true, strokeAlpha: true, rotation: true,
        reactToSpeed: true, sparkleDust: true, trails: true
      },
      symmetryMin: 6, symmetryMax: 26,
      brushMin: 1, brushMax: 12,
      glowMin: 4, glowMax: 24,
      patterns: ['rose', 'spiral', 'lissajous', 'drift', 'epicycle', 'lemniscate', 'wave']
    },
    panelCollapsed: true,
    todoCollapsed: false,
    todos: [],
    stickyNote: '',
    todoSound: { volume: 50, muted: false },
    links: [],
    // focusTimer stays the daily "focused today" total (date-keyed, resets
    // each calendar day); pomodoro holds the timer config + the live run
    // state so an in-progress session survives opening a new tab
    focusTimer: { date: '', seconds: 0 },
    pomodoro: {
      workMin: 25, shortMin: 5, longMin: 15, cyclesToLong: 4,
      run: { phase: 'work', running: false, endsAt: 0, remainingSec: null, cycleCount: 0 }
    }
  };

  function isPlainObject(v){
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function deepMerge(base, extra){
    if (!isPlainObject(extra)) return extra === undefined ? base : extra;
    const out = Object.assign({}, base);
    Object.keys(extra).forEach((k) => { out[k] = deepMerge(base ? base[k] : undefined, extra[k]); });
    return out;
  }

  async function load(){
    const stored = await browser.storage.local.get('state');
    return deepMerge(DEFAULT_STATE, stored.state || {});
  }

  async function save(state){
    await browser.storage.local.set({ state });
    return state;
  }

  // merges `value` into state[key] (or replaces it if value isn't an object) and persists
  async function patch(key, value){
    const state = await load();
    state[key] = isPlainObject(value) ? deepMerge(state[key], value) : value;
    await save(state);
    return state;
  }

  window.MandalaStorage = { DEFAULT_STATE, load, save, patch, deepMerge };
})();
