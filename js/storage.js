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
      rotateSpeed: 0.15, chaos: 0, sparkleDust: false, idleDraw: true,
      // off by default — running two idle pens roughly doubles idle-draw
      // cost, fine on capable hardware but not something to force on
      // everyone's machine
      doubleIdlePattern: false,
      cycleBuildSeconds: 60
    },
    panelCollapsed: true,
    todoCollapsed: false,
    todos: [],
    stickyNote: '',
    todoSound: { volume: 50, muted: false },
    links: [],
    focusTimer: { date: '', seconds: 0 }
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
