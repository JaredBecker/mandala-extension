// ---------- mandala WebGL renderer + settings panel wiring ----------
// Behavioural port of js/sketch.js (the p5 version) to raw WebGL. Loaded by
// render-loader.js when a GL context is available; otherwise the p5 sketch
// loads instead. Kept deliberately parallel in structure to sketch.js so the
// two can be diffed/kept in sync — same variable names, same functions, same
// comments where the logic is shared. Differences worth knowing:
//
//  * The trail buffer is a floating-point texture where supported, which
//    genuinely fixes the "fade never fully clears" residue: 8-bit canvas
//    pixels stop converging once the per-frame delta rounds to zero, but in
//    float the fade keeps converging below visible thresholds forever. The
//    8-bit correction-ramp trick from sketch.js is kept only as a fallback
//    for GPUs without renderable float textures.
//  * Glow is part of the stroke shader (an analytic falloff around each
//    capsule) instead of canvas shadowBlur, so it costs nothing extra.
//  * Strokes are drawn as "SDF capsules": each segment becomes one quad and
//    the fragment shader computes distance to the segment, giving perfectly
//    round caps + antialiasing + glow in a single pass.
(function () {
'use strict';

// ---------- settings state (names/defaults mirror sketch.js) ----------
let symmetry = 12;
let mirror = true;
let brushSize = 10;
let reactToSpeed = false;
let colourMode = 'rainbow';
let solidColourHex = '#ff3e94';
let trailMode = 'fade';
let fadeSpeed = 4;
let bgColourHex = '#0a0a0a';
let bgColour; // {h,s,b} — HSB like the p5 version's bgColourP5

let palette = 'full';
let customPalette = ['#ff3e94', '#7b2ff7', '#00e5ff'];
let glowIntensity = 0;
let pulseBrush = false;
let strokeStyleMode = 'rails';
let symmetryMode = 'radial'; // radial | kaleido | spiral | grid
let autoRotate = false;
let rotateSpeed = 0.15;
let sparkleDust = false;
let idleDraw = true;
let doubleIdlePattern = false;
let strokeAlpha = 92;        // stroke opacity, 0-100 like p5's HSB alpha
let rainbowSpeed = 0.7;      // hue-cycle rate in rainbow colour mode
let idlePace = 100;          // % multiplier on ambient drawing speed
let idleShuffleSeconds = 10; // how often ambient drawing restyles itself

let rotationAngle = 0;
let bufferSize = 0;
let frameCount = 0;
let hueShift = 0;
let lastX = null, lastY = null;
let particles = [];

// ---------- silk wisps (after weavesilk.com) ----------
// The pointer lays points into a rope; every frame the rope is nudged by a
// Perlin-noise force field and the WHOLE rope is redrawn several times at
// very low alpha with additive blending. The smoke sheets are hundreds of
// ghost copies of the rope accumulating as the noise wiggles it — density,
// not blur, makes the glow. (Numbers mirror sketch.js — keep in sync.)
const SILK_STEPS_PER_FRAME = 3; // physics+draw passes per frame (ghost density)
const SILK_POINT_LIFE = 100;    // steps a rope point lives after being laid
const SILK_MAX_ROPE_POINTS = 120; // hard cap so a rope can't grow unbounded
const SILK_MAX_ROPES = 6;         // mouse + idle pens + a couple of leftovers
const SILK_FRICTION = 0.975;      // carries constraint corrections, like silk cloth
const SILK_RIGIDITY = 0.2;        // neighbour pull-together per step
const SILK_NOISE_SPACE = 0.02;    // noise field scale per buffer px
const SILK_NOISE_TIME = 0.004;    // 2D noise here: time drifts the sample point
const SILK_NOISE_ANGLE = 5 * Math.PI; // noise value -> force angle sweep (Math.PI: the PI const is declared further down — TDZ)
const SILK_IVEL_FORCE = 0.3;      // launch push from the cursor's velocity
const SILK_IVEL_DECAY = 0.98;
let silkRopes = [];  // { pts: [{x,y,px,py,ivx,ivy,life}], lastInX, lastInY }
let silkTime = 0;    // physics step counter driving the noise field drift

// screen-space endpoints of last frame's strokes: a stroke whose start
// matches one of them is a continuation, so its start cap gets subtracted
// in the shader instead of double-blending over the previous end cap
let prevStrokeEnds = [];
let curStrokeEnds = [];

// ---------- Depth: perspective camera over the art plane ----------
// The art buffer stays strictly 2D; Depth tilts the PLANE it's shown on.
// The camera itself never moves — camPitch/camYaw tilt the plane's model
// transform, which is equivalent and keeps the math small. userPitch/userYaw
// are the Shift+drag / two-finger set point (session-only, Reset zeroes
// them); an ambient noise drift scaled by depthAmount breathes on top.
const CAM_FOV_COT = 3.7321;             // cot(15°) — a 30° vertical FOV
const TILT_LIMIT = 45;                  // degrees, per axis, user + drift
let depthAmount = 30;                   // 0 = flat classic look
let depthDrift = true;
let userPitch = 0, userYaw = 0;         // degrees
let camPitch = 0, camYaw = 0;           // radians, effective this frame
let driftT = Math.random() * 1000;
let shiftDown = false;                  // Shift pauses drawing, drag tilts
let tiltDragging = false;
let tiltLastX = 0, tiltLastY = 0;
let twoFingerTilt = null;               // {x,y} centroid while 2 fingers down

// basis vectors of the tilted, spun plane: M = Ry(yaw)·Rx(pitch)·Rz(spin).
// Used identically by the present pass (forward) and the cursor
// unprojection (inverse), so strokes always land under the pointer.
function planeBasis(){
  const a = radians(rotationAngle);
  const ca = cos(a), sa = sin(a);
  const cp = cos(camPitch), sp = sin(camPitch);
  const cy = cos(camYaw), sy = sin(camYaw);
  return {
    e1: [ca * cy + sa * sp * sy, sa * cp, -ca * sy + sa * sp * cy],
    e2: [-sa * cy + ca * sp * sy, ca * cp, sa * sy + ca * sp * cy]
  };
}

// while a breathing session is active it temporarily drives rotateSpeed;
// the panel-driven value is preserved here and restored on exit
let userRotateSpeed = rotateSpeed;
let breathingActive = false;

const PALETTE_RANGES = {
  full:   [0, 360],
  sunset: [320, 400],
  ocean:  [170, 250],
  forest: [70, 170],
  mono:   [38, 54]
};

// hue ranges for the "Match my weather" palette, keyed by the coarse mood
// weather.js publishes on window.MandalaWeatherMood
const WEATHER_MOOD_RANGES = {
  clear: [25, 70],    // golden sunshine
  cloud: [210, 280],  // slate blues into violet
  fog:   [175, 215],  // pale teals
  rain:  [185, 250],  // rain blues
  snow:  [170, 215],  // icy cyans
  storm: [255, 330]   // bruised purples
};

// resolves the active hue range — the two "living" palettes pick theirs
// from the clock / the weather widget instead of a fixed table entry
function paletteRange(){
  if (palette === 'daycycle'){
    const h = new Date().getHours();
    if (h >= 5 && h < 9) return [300, 420];   // dawn: pinks warming into gold
    if (h >= 9 && h < 17) return [0, 360];    // day: the full spectrum
    if (h >= 17 && h < 21) return [260, 400]; // dusk: purples into ember orange
    return [180, 280];                        // night: deep blues
  }
  if (palette === 'weather'){
    return WEATHER_MOOD_RANGES[window.MandalaWeatherMood] || PALETTE_RANGES.full;
  }
  return PALETTE_RANGES[palette] || PALETTE_RANGES.full;
}

// blends through the user's custom palette stops, treated as a cycle (last
// blends back into first) so rainbow mode loops without a hard seam
function customPaletteHex(t){
  const stops = (customPalette && customPalette.length >= 2) ? customPalette : ['#ff3e94', '#00e5ff'];
  const n = stops.length;
  const pos = (((t % 1) + 1) % 1) * n;
  const i = floor(pos) % n;
  const f = pos - floor(pos);
  const a = stops[i], b = stops[(i + 1) % n];
  const ch = (o) => {
    const va = parseInt(a.slice(o, o + 2), 16), vb = parseInt(b.slice(o, o + 2), 16);
    return round(va + (vb - va) * f).toString(16).padStart(2, '0');
  };
  return '#' + ch(1) + ch(3) + ch(5);
}

// ---------- small math/colour helpers (p5 stand-ins) ----------
const TWO_PI = Math.PI * 2;
const PI = Math.PI;
const { sin, cos, abs, min, max, floor, round, hypot } = Math;

function random(a, b){
  if (Array.isArray(a)) return a[floor(Math.random() * a.length)];
  if (a === undefined) return Math.random();
  if (b === undefined) return Math.random() * a;
  return a + Math.random() * (b - a);
}

function constrain(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }
function radians(deg){ return deg * PI / 180; }

// p5-style layered value noise (4 octaves, 0.5 falloff, output 0..1) — the
// idle path algorithms only need "smooth wandering value", not exact Perlin
const PERLIN_SIZE = 4095;
let perlinArr = null;
function noise(x, y = 0){
  if (!perlinArr){
    perlinArr = new Array(PERLIN_SIZE + 1);
    for (let i = 0; i <= PERLIN_SIZE; i++) perlinArr[i] = Math.random();
  }
  x = abs(x); y = abs(y);
  let xi = floor(x), yi = floor(y);
  let xf = x - xi, yf = y - yi;
  let r = 0, ampl = 0.5;
  for (let o = 0; o < 4; o++){
    const of = xi + (yi << 4);
    const rxf = 0.5 * (1 - cos(xf * PI));
    const ryf = 0.5 * (1 - cos(yf * PI));
    let n1 = perlinArr[of & PERLIN_SIZE];
    n1 += rxf * (perlinArr[(of + 1) & PERLIN_SIZE] - n1);
    let n2 = perlinArr[(of + 16) & PERLIN_SIZE];
    n2 += rxf * (perlinArr[(of + 17) & PERLIN_SIZE] - n2);
    n1 += ryf * (n2 - n1);
    r += n1 * ampl;
    ampl *= 0.5;
    xi <<= 1; xf *= 2;
    yi <<= 1; yf *= 2;
    if (xf >= 1){ xi++; xf--; }
    if (yf >= 1){ yi++; yf--; }
  }
  return r;
}

// HSB here matches p5's colorMode(HSB, 360, 100, 100, 100)
function hsbToRgb(h, s, b){
  h = ((h % 360) + 360) % 360;
  s = constrain(s, 0, 100) / 100;
  b = constrain(b, 0, 100) / 100;
  const c = b * s;
  const x = c * (1 - abs(((h / 60) % 2) - 1));
  const m = b - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60){ r1 = c; g1 = x; }
  else if (h < 120){ r1 = x; g1 = c; }
  else if (h < 180){ g1 = c; b1 = x; }
  else if (h < 240){ g1 = x; b1 = c; }
  else if (h < 300){ r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  return [r1 + m, g1 + m, b1 + m];
}

function hexToHSB(hex){
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = max(r, max(g, b)), mn = min(r, min(g, b));
  const d = mx - mn;
  let h = 0;
  if (d > 0){
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  h = ((h % 360) + 360) % 360;
  return { h, s: mx === 0 ? 0 : (d / mx) * 100, b: mx * 100, a: 100 };
}

function hsbToHex(h, s, b){
  const [r, g, bl] = hsbToRgb(h, s, b);
  const to2 = (v) => round(v * 255).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(bl);
}

// ---------- 'cycle' trail mode (identical logic to sketch.js) ----------
let cycleBuildSeconds = 60;
let cyclePhase = 'building';
let cyclePhaseStartMs = Date.now();

function resetCyclePhase(){
  cyclePhase = 'building';
  cyclePhaseStartMs = Date.now();
}

function updateCyclePhase(){
  const elapsed = Date.now() - cyclePhaseStartMs;
  if (cyclePhase === 'building'){
    if (elapsed > cycleBuildSeconds * 1000){
      cyclePhase = 'fading';
      cyclePhaseStartMs = Date.now();
    }
  } else {
    const fadePhaseMs = constrain(round(60000 / fadeSpeed), 3000, 30000);
    if (elapsed > fadePhaseMs){
      cyclePhase = 'building';
      cyclePhaseStartMs = Date.now();
    }
  }
}

// theme color drives the canvas background AND the panel's glass tint —
// same as sketch.js
function applyThemeFromBg(hex){
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.setProperty('--panel-bg', `rgba(${r}, ${g}, ${b}, 0.68)`);
  const lr = Math.round(r + (255 - r) * 0.12);
  const lg = Math.round(g + (255 - g) * 0.12);
  const lb = Math.round(b + (255 - b) * 0.12);
  document.documentElement.style.setProperty('--select-bg', `rgb(${lr}, ${lg}, ${lb})`);
}

// ---------- idle ambient drawing (identical logic to sketch.js) ----------
const IDLE_THRESHOLD_MS = 1000;
const IDLE_PATH_ALGORITHMS = ['rose', 'spiral', 'lissajous', 'drift', 'epicycle', 'lemniscate', 'wave'];
let lastRealInput = Date.now();
// a freshly opened tab starts drawing on frame one instead of sitting empty
// for the idle threshold — the wait only applies after real input has
// happened at least once
let hasInteracted = false;
let idleActive = false;
let idlePens = [];
let idleSpeedT = 0;
let idlePrevConfig = null;
let idleConfigTimer = null;

// what the Ambient tab allows the shuffle to change; replaced with the
// stored preferences by main.js via applyAmbientState
let ambient = {
  randomize: {
    symmetry: true, brush: true, pulseBrush: true,
    colours: true, glow: true, strokeAlpha: true, rotation: true,
    reactToSpeed: true, sparkleDust: true, trails: true
  },
  symmetryMin: 6, symmetryMax: 26,
  brushMin: 1, brushMax: 12,
  glowMin: 4, glowMax: 24,
  symModes: ['radial', 'kaleido', 'spiral', 'grid'],
  styles: ['line', 'ribbon', 'dots', 'sparkle', 'rails', 'rings', 'petals', 'taper', 'chalk', 'dashed', 'silk'],
  patterns: IDLE_PATH_ALGORITHMS.slice(),
  gallery: false,
  gallerySeconds: 45
};
window.applyAmbientState = (a) => { ambient = a; };

// gallery mode phase state: while ambient, build for gallerySeconds, then
// dissolve the piece over a couple of seconds, restyle, and start fresh
let galleryFading = false;
let galleryPhaseStart = Date.now();

// builds the next ambient look. Starts from the USER's config (captured
// when ambient mode began — not the previous roll) and only re-rolls what
// the Ambient tab allows, inside its limits, so anything unticked keeps
// the user's own setting.
function randomCosmeticConfig(){
  const cfg = Object.assign({}, idlePrevConfig || captureCosmeticConfig());
  const R = ambient.randomize;
  const span = (lo, hi) => floor(random(min(lo, hi), max(lo, hi) + 1));
  cfg.mirror = true;
  if (R.symmetry) cfg.symmetry = span(ambient.symmetryMin, ambient.symmetryMax);
  // symmetry styles are a user-picked pool (all unticked = keep the user's
  // geometry); radial stays weighted heaviest when allowed — it's the
  // classic look, the others are accents
  if (ambient.symModes && ambient.symModes.length){
    const pool = ambient.symModes.slice();
    if (pool.includes('radial')) pool.push('radial', 'radial');
    cfg.symmetryMode = random(pool);
  }
  // stroke styles are their own pool (all unticked = keep the user's brush)
  if (ambient.styles && ambient.styles.length) cfg.strokeStyleMode = random(ambient.styles);
  if (R.pulseBrush) cfg.pulseBrush = random() > 0.5;
  if (R.colours){
    cfg.colourMode = random(['rainbow', 'gradient', 'solid']);
    cfg.palette = random(['full', 'sunset', 'ocean', 'forest', 'mono']);
    cfg.solidColourHex = hsbToHex(random(360), 75, 100);
    cfg.rainbowSpeed = random(0.3, 1.5);
  }
  // kept above 55 so ambient art never looks washed out on the shuffle
  if (R.strokeAlpha) cfg.strokeAlpha = floor(random(55, 101));
  if (R.glow) cfg.glowIntensity = span(ambient.glowMin, ambient.glowMax);
  if (R.brush) cfg.brushSize = span(ambient.brushMin, ambient.brushMax);
  if (R.reactToSpeed) cfg.reactToSpeed = random() > 0.3;
  if (R.sparkleDust) cfg.sparkleDust = random() > 0.6;
  if (R.rotation){
    cfg.rotateSpeed = random(0, 0.25);
    cfg.autoRotate = random() > 0.35;
  }
  if (R.trails){
    cfg.trailMode = random(['fade', 'permanent', 'cycle']);
    cfg.fadeSpeed = floor(random(3, 22));
    // short build time so cycle mode reaches its fade phase within a
    // shuffle window instead of just looking like permanent mode
    cfg.cycleBuildSeconds = floor(random(5, 15));
  }
  // gallery mode owns the piece's lifecycle (build → dissolve → new), so
  // strokes must accumulate crisply until the dissolve — no competing fade
  if (ambient.gallery) cfg.trailMode = 'permanent';
  return cfg;
}

function captureCosmeticConfig(){
  return {
    symmetry, mirror, symmetryMode, strokeStyleMode, pulseBrush, colourMode, palette,
    solidColourHex, glowIntensity, brushSize, reactToSpeed, sparkleDust, rotateSpeed,
    autoRotate, trailMode, fadeSpeed, cycleBuildSeconds, strokeAlpha, rainbowSpeed
  };
}

function applyCosmeticConfig(cfg){
  ({
    symmetry, mirror, symmetryMode, strokeStyleMode, pulseBrush, colourMode, palette,
    solidColourHex, glowIntensity, brushSize, reactToSpeed, sparkleDust, rotateSpeed,
    autoRotate, trailMode, fadeSpeed, cycleBuildSeconds, strokeAlpha, rainbowSpeed
  } = cfg);
  if (trailMode === 'cycle') resetCyclePhase();
}

function pickIdlePathAlgorithms(){
  // only pick from patterns the Ambient tab has enabled (fall back to all
  // of them if every single one has been unticked)
  const pool = (ambient.patterns && ambient.patterns.length) ? ambient.patterns : IDLE_PATH_ALGORITHMS;
  const penCount = doubleIdlePattern ? 2 : 1;
  const chosen = [];
  idlePens = [];
  for (let i = 0; i < penCount; i++){
    let algorithm;
    do {
      algorithm = random(pool);
    } while (chosen.includes(algorithm) && chosen.length < pool.length);
    chosen.push(algorithm);
    idlePens.push({ x: null, y: null, dirAngle: random(TWO_PI), pulseT: 0, algorithm });
  }
}

function enterIdleConfigShuffle(){
  idlePrevConfig = captureCosmeticConfig();
  applyCosmeticConfig(randomCosmeticConfig());
  pickIdlePathAlgorithms();
  galleryFading = false;
  galleryPhaseStart = Date.now();
  idleConfigTimer = setInterval(() => {
    // in gallery mode the restyle happens when a piece dissolves (see
    // frame()), not on this fixed clock
    if (ambient.gallery) return;
    applyCosmeticConfig(randomCosmeticConfig());
    pickIdlePathAlgorithms();
  }, idleShuffleSeconds * 1000);
}

function exitIdleConfigShuffle(){
  if (idleConfigTimer){ clearInterval(idleConfigTimer); idleConfigTimer = null; }
  if (idlePrevConfig){ applyCosmeticConfig(idlePrevConfig); idlePrevConfig = null; }
}

// mouse tracking: p5 gave us mouseX/mouseY for free; pointermove covers
// mouse + touch + pen with the same event
let mouseX = 0, mouseY = 0;
let mouseOverUI = false;

function wireInputTracking(){
  window.addEventListener('pointermove', (e) => {
    if (tiltDragging){
      // Shift+drag steers the camera instead of painting
      userYaw = constrain(userYaw + (e.clientX - tiltLastX) * 0.25, -TILT_LIMIT, TILT_LIMIT);
      userPitch = constrain(userPitch - (e.clientY - tiltLastY) * 0.25, -TILT_LIMIT, TILT_LIMIT);
      tiltLastX = e.clientX; tiltLastY = e.clientY;
      lastRealInput = Date.now();
      return;
    }
    mouseX = e.clientX; mouseY = e.clientY;
    // moving around the menu isn't drawing intent — ambient mode keeps
    // painting behind the panel. Actually touching a control still wakes
    // it (the capture-phase listeners in wireUpPanel), so changes made
    // there are never clobbered by the shuffle's restore-on-wake.
    if (mouseOverUI) return;
    lastRealInput = Date.now();
    hasInteracted = true;
    if (idleActive){
      idleActive = false;
      lastX = null; lastY = null; // force a fresh starting point, not a stale pre-idle one
      exitIdleConfigShuffle();
    }
    // establish a clean starting point from this real event's actual position
    if (lastX === null){
      lastX = mouseX; lastY = mouseY;
    }
  });
  window.addEventListener('touchstart', () => { lastRealInput = Date.now(); hasInteracted = true; }, { passive: true });

  // Shift+double-click snaps the camera back to flat
  canvas.addEventListener('dblclick', (e) => {
    if (e.shiftKey){ userPitch = 0; userYaw = 0; }
  });

  // ---- Depth camera input ----
  // holding Shift pauses drawing; Shift+drag tilts. Ending either resets
  // lastX so drawing resumes cleanly from wherever the cursor is then.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !shiftDown){
      shiftDown = true;
      lastX = null; lastY = null;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift'){
      shiftDown = false;
      tiltDragging = false;
      lastX = null; lastY = null;
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.shiftKey && e.isPrimary){
      tiltDragging = true;
      tiltLastX = e.clientX; tiltLastY = e.clientY;
    }
  });
  window.addEventListener('pointerup', () => {
    if (tiltDragging){
      tiltDragging = false;
      lastX = null; lastY = null;
    }
  });

  // two fingers tilt on touch; a single finger keeps painting as before
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2){
      twoFingerTilt = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
      lastX = null; lastY = null;
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (twoFingerTilt && e.touches.length === 2){
      e.preventDefault();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      userYaw = constrain(userYaw + (mx - twoFingerTilt.x) * 0.25, -TILT_LIMIT, TILT_LIMIT);
      userPitch = constrain(userPitch - (my - twoFingerTilt.y) * 0.25, -TILT_LIMIT, TILT_LIMIT);
      twoFingerTilt = { x: mx, y: my };
    }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (twoFingerTilt && e.touches.length < 2){
      twoFingerTilt = null;
      lastX = null; lastY = null;
    }
  }, { passive: true });

  // pause drawing while the cursor is over panel/HUD/overlays (see sketch.js)
  document.querySelectorAll('.ui').forEach((el) => {
    el.addEventListener('mouseenter', () => { mouseOverUI = true; });
    el.addEventListener('mouseleave', () => { mouseOverUI = false; });
  });
}

function computeBufferSize(){
  return Math.ceil(Math.sqrt(window.innerWidth * window.innerWidth + window.innerHeight * window.innerHeight)) + 4;
}

// maps a screen-space point to the art buffer's un-rotated coordinate space,
// cancelling out the current display rotation (and, when Depth has the
// plane tilted, the whole perspective projection)
function toBufferSpace(x, y){
  const w = canvas.width, h = canvas.height;

  if (camPitch === 0 && camYaw === 0){
    // flat: plain 2D inverse rotation, identical to sketch.js
    const dx = x - w / 2, dy = y - h / 2;
    const a = radians(-rotationAngle);
    const cosA = cos(a), sinA = sin(a);
    return {
      x: bufferSize / 2 + dx * cosA - dy * sinA,
      y: bufferSize / 2 + dx * sinA + dy * cosA
    };
  }

  // tilted: cast a ray from the camera at (0,0,D) through the pixel and
  // intersect the tilted plane — solve u·e1 + v·e2 = O + t·d for the
  // plane-local (u,v) by Cramer's rule
  const { e1, e2 } = planeBasis();
  const D = (h / 2) * CAM_FOV_COT;
  const ndcX = 2 * x / w - 1;
  const ndcY = 1 - 2 * y / h;
  const d = [ndcX * (w / h) / CAM_FOV_COT, -ndcY / CAM_FOV_COT, -1];

  const m00 = e1[0], m01 = e2[0], m02 = -d[0];
  const m10 = e1[1], m11 = e2[1], m12 = -d[1];
  const m20 = e1[2], m21 = e2[2], m22 = -d[2];
  const det = m00 * (m11 * m22 - m12 * m21)
            - m01 * (m10 * m22 - m12 * m20)
            + m02 * (m10 * m21 - m11 * m20);
  if (abs(det) < 1e-9){
    return { x: bufferSize / 2, y: bufferSize / 2 }; // grazing ray; never at our tilt limits
  }
  const u = (D * (m01 * m12 - m02 * m11)) / det;
  const v = (-D * (m00 * m12 - m02 * m10)) / det;
  return { x: bufferSize / 2 + u, y: bufferSize / 2 + v };
}

// ---------- WebGL renderer ----------
let canvas = null;
let gl = null;
let isWebGL2 = false;
let floatTrails = false; // trail buffer is float16 (no 8-bit fade residue)
let contextLost = false;
let rafId = 0;
let lastFrameMs = 0;

let capsuleProg, flatProg, texProg;
let capsuleVBO, flatVBO, texVBO;
let artTex = null, artFBO = null;

// per-frame geometry batches (plain arrays; a few hundred floats a frame)
let capsuleVerts = [];
let flatVerts = [];
// silk gets its own capsule batch: it must blend ADDITIVELY (that stacking
// is the whole smoke effect) while everything else stays source-over
let silkVerts = [];

const CAPSULE_VS = `
attribute vec2 aPos;
attribute vec4 aSeg;
attribute vec3 aParam;
attribute vec4 aColor;
uniform vec2 uRes;
varying vec2 vPos;
varying vec4 vSeg;
varying vec3 vParam;
varying vec4 vColor;
void main(){
  vPos = aPos; vSeg = aSeg; vParam = aParam; vColor = aColor;
  gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

// distance-to-segment gives a capsule (round caps for free); the smoothstep
// edge is the antialiasing; the exp() term is the glow halo standing in for
// canvas shadowBlur.
//
// Strokes arrive one short segment per frame, and translucent round caps
// double-blend where consecutive segments meet — visible as a bright bead
// at every joint (a "chain of circles" at slow speeds). For continuing
// segments (aParam.z = 0) the shader therefore composes against the cap the
// PREVIOUS segment already painted around A: the extra alpha needed so the
// union blends exactly once is (max(seg,cap) - cap) / (1 - cap).
const CAPSULE_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
varying vec4 vSeg;
varying vec3 vParam;
varying vec4 vColor;
float cover(float d, float hw, float glow){
  float a = 1.0 - smoothstep(hw - 0.75, hw + 0.75, d);
  if (glow > 0.01){
    float t = max(d - hw, 0.0) / glow;
    a = max(a, exp(-t * t * 3.0) * 0.5);
  }
  return a;
}
void main(){
  vec2 pa = vPos - vSeg.xy;
  vec2 ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  float hw = vParam.x;
  float glow = vParam.y;
  float a;
  if (vParam.z > 1.5){
    // ring stamp: a bright wall at radius hw, hollow inside
    float wall = max(1.5, hw * 0.16);
    float dr = abs(d - hw);
    a = 1.0 - smoothstep(wall - 0.75, wall + 0.75, dr);
    if (glow > 0.01){
      float t = max(dr - wall, 0.0) / glow;
      a = max(a, exp(-t * t * 3.0) * 0.5);
    }
  } else {
    a = cover(d, hw, glow);
    if (vParam.z < 0.5){
      float aCap = cover(length(pa), hw, glow);
      a = clamp((max(a, aCap) - aCap) / max(1.0 - aCap, 1e-4), 0.0, 1.0);
    }
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

const FLAT_VS = `
attribute vec2 aPos;
attribute vec4 aColor;
uniform vec2 uRes;
varying vec4 vColor;
void main(){
  vColor = aColor;
  gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const FLAT_FS = `
precision mediump float;
varying vec4 vColor;
void main(){ gl_FragColor = vColor; }`;

// the display quad's clip-space coordinates (with perspective w) are
// computed on the CPU — four vertices a frame; GL's perspective-correct
// varying interpolation handles the rest
const TEX_VS = `
attribute vec4 aPos;
attribute vec2 aUV;
varying vec2 vUV;
void main(){
  vUV = aUV;
  gl_Position = aPos;
}`;

const TEX_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUV;
void main(){ gl_FragColor = vec4(texture2D(uTex, vUV).rgb, 1.0); }`;

function compileShader(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    throw new Error('shader compile: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function createProgram(vsSrc, fsSrc, attribNames, uniformNames){
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)){
    throw new Error('program link: ' + gl.getProgramInfoLog(prog));
  }
  const p = { prog, attribs: {}, uniforms: {} };
  attribNames.forEach((n) => { p.attribs[n] = gl.getAttribLocation(prog, n); });
  uniformNames.forEach((n) => { p.uniforms[n] = gl.getUniformLocation(prog, n); });
  return p;
}

// trail buffer: float16 where renderable (WebGL2 + EXT_color_buffer_float,
// or WebGL1 half-float extensions), else plain 8-bit RGBA
function createArtTarget(size){
  if (artTex) gl.deleteTexture(artTex);
  if (artFBO) gl.deleteFramebuffer(artFBO);

  const tryCreate = (useFloat) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (useFloat && isWebGL2){
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else if (useFloat){
      const hf = gl.getExtension('OES_texture_half_float');
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, hf.HALF_FLOAT_OES, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE){
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      return null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  };

  let target = null;
  if (floatTrails) target = tryCreate(true);
  if (!target){
    floatTrails = false;
    target = tryCreate(false);
  }
  if (!target) throw new Error('could not create trail framebuffer');
  artTex = target.tex;
  artFBO = target.fbo;
}

function detectFloatSupport(){
  if (isWebGL2){
    return !!gl.getExtension('EXT_color_buffer_float');
  }
  return !!(gl.getExtension('OES_texture_half_float') &&
            gl.getExtension('OES_texture_half_float_linear') &&
            gl.getExtension('EXT_color_buffer_half_float'));
}

function initGL(){
  gl = canvas.getContext('webgl2', { alpha: false, antialias: true }) ||
       canvas.getContext('webgl', { alpha: false, antialias: true });
  if (!gl) throw new Error('no WebGL context');
  isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined') && gl instanceof WebGL2RenderingContext;
  floatTrails = detectFloatSupport();

  capsuleProg = createProgram(CAPSULE_VS, CAPSULE_FS,
    ['aPos', 'aSeg', 'aParam', 'aColor'], ['uRes']);
  flatProg = createProgram(FLAT_VS, FLAT_FS, ['aPos', 'aColor'], ['uRes']);
  texProg = createProgram(TEX_VS, TEX_FS, ['aPos', 'aUV'], ['uTex']);

  capsuleVBO = gl.createBuffer();
  flatVBO = gl.createBuffer();
  texVBO = gl.createBuffer();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);

  createArtTarget(bufferSize);
  clearArt();
}

function bindArt(){
  gl.bindFramebuffer(gl.FRAMEBUFFER, artFBO);
  gl.viewport(0, 0, bufferSize, bufferSize);
}

function clearArt(){
  const [r, g, b] = hsbToRgb(bgColour.h, bgColour.s, bgColour.b);
  bindArt();
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  silkRopes = []; // live ropes would redraw ghosts onto the fresh canvas
}

// geometry emitters — everything lands in this frame's batch arrays and is
// flushed into the art buffer once per frame (order within a batch is
// preserved by GL, so blending stacks the same way sequential p5 calls did)

// cap = 1: stand-alone stamp with full round caps (dots, particles, halos,
// or the first segment of a stroke). cap = 0: continues an existing stroke,
// so the shader subtracts the cap the previous segment already painted at A.
function emitCapsule(ax, ay, bx, by, halfWidth, glowRadius, r, g, b, a, cap, out = capsuleVerts){
  // slack covers antialiasing plus the ring mode's wall, which extends
  // beyond the nominal radius
  const pad = halfWidth + glowRadius + max(6, halfWidth * 0.2);
  let dx = bx - ax, dy = by - ay;
  const len = hypot(dx, dy);
  if (len < 1e-6){ dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  const nx = -dy, ny = dx;
  const x0 = ax - dx * pad, y0 = ay - dy * pad;
  const x1 = bx + dx * pad, y1 = by + dy * pad;
  const c = [
    x0 + nx * pad, y0 + ny * pad,
    x0 - nx * pad, y0 - ny * pad,
    x1 + nx * pad, y1 + ny * pad,
    x1 - nx * pad, y1 - ny * pad
  ];
  const idx = [0, 1, 2, 1, 3, 2];
  for (let i = 0; i < 6; i++){
    const k = idx[i] * 2;
    out.push(c[k], c[k + 1], ax, ay, bx, by, halfWidth, glowRadius, cap, r, g, b, a);
  }
}

// 4-point star as a triangle fan (hard-edged, like p5's fill()ed drawStar;
// its shadow-glow equivalent is emitted separately as a capsule halo)
function emitStar(x, y, radius1, radius2, npoints, r, g, b, a){
  const angle = TWO_PI / npoints;
  const halfAngle = angle / 2;
  const pts = [];
  for (let t = 0; t < TWO_PI - 1e-9; t += angle){
    pts.push(x + cos(t) * radius2, y + sin(t) * radius2);
    pts.push(x + cos(t + halfAngle) * radius1, y + sin(t + halfAngle) * radius1);
  }
  const n = pts.length / 2;
  for (let i = 0; i < n; i++){
    const j = (i + 1) % n;
    flatVerts.push(x, y, r, g, b, a);
    flatVerts.push(pts[i * 2], pts[i * 2 + 1], r, g, b, a);
    flatVerts.push(pts[j * 2], pts[j * 2 + 1], r, g, b, a);
  }
}

function emitFullQuad(r, g, b, a){
  const s = bufferSize;
  const quad = [0, 0, s, 0, 0, s, s, 0, s, s, 0, s];
  for (let i = 0; i < 12; i += 2){
    flatVerts.push(quad[i], quad[i + 1], r, g, b, a);
  }
}

function flushBatches(){
  bindArt();
  if (flatVerts.length){
    gl.useProgram(flatProg.prog);
    gl.uniform2f(flatProg.uniforms.uRes, bufferSize, bufferSize);
    gl.bindBuffer(gl.ARRAY_BUFFER, flatVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flatVerts), gl.DYNAMIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(flatProg.attribs.aPos);
    gl.vertexAttribPointer(flatProg.attribs.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(flatProg.attribs.aColor);
    gl.vertexAttribPointer(flatProg.attribs.aColor, 4, gl.FLOAT, false, stride, 8);
    gl.drawArrays(gl.TRIANGLES, 0, flatVerts.length / 6);
    gl.disableVertexAttribArray(flatProg.attribs.aPos);
    gl.disableVertexAttribArray(flatProg.attribs.aColor);
    flatVerts = [];
  }
  if (capsuleVerts.length){
    drawCapsuleBatch(capsuleVerts);
    capsuleVerts = [];
  }
  if (silkVerts.length){
    // additive: src alpha in, everything already there kept at full — ghost
    // passes stack toward white exactly like canvas2d's 'lighter'
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    drawCapsuleBatch(silkVerts);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    silkVerts = [];
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function drawCapsuleBatch(verts){
  gl.useProgram(capsuleProg.prog);
  gl.uniform2f(capsuleProg.uniforms.uRes, bufferSize, bufferSize);
  gl.bindBuffer(gl.ARRAY_BUFFER, capsuleVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
  const stride = 13 * 4;
  gl.enableVertexAttribArray(capsuleProg.attribs.aPos);
  gl.vertexAttribPointer(capsuleProg.attribs.aPos, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(capsuleProg.attribs.aSeg);
  gl.vertexAttribPointer(capsuleProg.attribs.aSeg, 4, gl.FLOAT, false, stride, 8);
  gl.enableVertexAttribArray(capsuleProg.attribs.aParam);
  gl.vertexAttribPointer(capsuleProg.attribs.aParam, 3, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(capsuleProg.attribs.aColor);
  gl.vertexAttribPointer(capsuleProg.attribs.aColor, 4, gl.FLOAT, false, stride, 36);
  gl.drawArrays(gl.TRIANGLES, 0, verts.length / 13);
  gl.disableVertexAttribArray(capsuleProg.attribs.aPos);
  gl.disableVertexAttribArray(capsuleProg.attribs.aSeg);
  gl.disableVertexAttribArray(capsuleProg.attribs.aParam);
  gl.disableVertexAttribArray(capsuleProg.attribs.aColor);
}

// like sketch.js's flat-batch/capsule split: the fade rect must land UNDER
// this frame's strokes, so it gets its own immediate flush
function fadePass(alpha){
  const [r, g, b] = hsbToRgb(bgColour.h, bgColour.s, bgColour.b);
  emitFullQuad(r, g, b, alpha / 100);
  flushBatches();
}

// blit the art buffer to the screen rotated by rotationAngle — the buffer
// itself is never resampled-and-restored, so trails stay crisp (same
// approach as sketch.js's offscreen artLayer + image() call)
function present(){
  const w = canvas.width, h = canvas.height;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  const [r, g, b] = hsbToRgb(bgColour.h, bgColour.s, bgColour.b);
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // project the plane's corners through spin + tilt + perspective. The
  // camera sits at (0,0,D) with D chosen so an untilted plane fills the
  // viewport at exactly 1 world unit = 1 screen pixel — camPitch/camYaw of
  // zero therefore reproduces the old flat 2D blit bit-for-bit.
  const half = bufferSize / 2;
  const { e1, e2 } = planeBasis();
  const D = (h / 2) * CAM_FOV_COT;
  const aspect = w / h;
  const corner = (u, v, s, t, out) => {
    const wx = u * e1[0] + v * e2[0];
    const wy = u * e1[1] + v * e2[1];
    const wz = u * e1[2] + v * e2[2];
    out.push((CAM_FOV_COT / aspect) * wx, -CAM_FOV_COT * wy, 0, D - wz, s, t);
  };
  const verts = [];
  corner(-half, -half, 0, 0, verts);
  corner(half, -half, 1, 0, verts);
  corner(-half, half, 0, 1, verts);
  corner(half, -half, 1, 0, verts);
  corner(half, half, 1, 1, verts);
  corner(-half, half, 0, 1, verts);

  gl.useProgram(texProg.prog);
  gl.uniform1i(texProg.uniforms.uTex, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, artTex);
  gl.bindBuffer(gl.ARRAY_BUFFER, texVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
  const stride = 6 * 4;
  gl.enableVertexAttribArray(texProg.attribs.aPos);
  gl.vertexAttribPointer(texProg.attribs.aPos, 4, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texProg.attribs.aUV);
  gl.vertexAttribPointer(texProg.attribs.aUV, 2, gl.FLOAT, false, stride, 16);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.disableVertexAttribArray(texProg.attribs.aPos);
  gl.disableVertexAttribArray(texProg.attribs.aUV);
}

// ---------- frame loop (mirrors sketch.js draw()) ----------
function frame(nowMs){
  rafId = requestAnimationFrame(frame);
  if (contextLost) return;
  // p5 caps at 60fps by default; match it so fade/rotation/idle pacing is
  // identical on 120Hz+ displays
  if (nowMs - lastFrameMs < 1000 / 62) return;
  lastFrameMs = nowMs;
  frameCount++;

  if (autoRotate){
    rotationAngle = (rotationAngle + rotateSpeed) % 360;
  }

  // effective camera = user tilt + ambient drift, resolved once per frame
  // BEFORE any strokes so toBufferSpace and present agree on the transform
  driftT += 0.0016;
  let driftP = 0, driftY = 0;
  if (depthDrift && depthAmount > 0){
    const maxDrift = (depthAmount / 100) * 18;
    driftP = (noise(driftT) - 0.5) * 2 * maxDrift;
    driftY = (noise(driftT + 400) - 0.5) * 2 * maxDrift;
  }
  camPitch = radians(constrain(userPitch + driftP, -TILT_LIMIT, TILT_LIMIT));
  camYaw = radians(constrain(userYaw + driftY, -TILT_LIMIT, TILT_LIMIT));

  if (trailMode === 'cycle'){
    updateCyclePhase();
  }

  if (trailMode === 'fade' || (trailMode === 'cycle' && cyclePhase === 'fading')){
    let fadeAlpha = fadeSpeed;
    if (!floatTrails){
      // 8-bit fallback only: the periodic correction "breath" from
      // sketch.js, needed because low fade alphas stop converging on 8-bit
      // pixels and leave a permanent faint tint. Float trails don't have
      // the problem — the fade keeps converging below visible levels.
      const correctionCycle = max(20, round(300 / fadeSpeed));
      const correctionPhase = (frameCount % correctionCycle) / correctionCycle;
      let correctionBoost = Math.pow(max(0, sin(PI * correctionPhase)), 8);
      // the breath can't tell residue from fresh ink — while the user is
      // actively drawing it would eat their strokes as fast as they're
      // laid (paint… vanish… paint again, on the cycle above). Hold it
      // off until the hand has rested a moment; the residue it exists to
      // clean builds over minutes, so correcting between strokes is plenty.
      if (Date.now() - lastRealInput < 2000) correctionBoost = 0;
      fadeAlpha = fadeSpeed + correctionBoost * (60 - fadeSpeed);
    }
    fadePass(fadeAlpha);
  }

  prevStrokeEnds = curStrokeEnds;
  curStrokeEnds = [];

  updateAndDrawParticles();

  // !hasInteracted: a fresh tab starts drawing immediately — nobody should
  // stare at an empty canvas waiting out the idle threshold on open.
  // The cursor being over the panel doesn't block this: browsing the menu
  // still counts as idle, so ambient art keeps playing behind it.
  if (idleDraw && !idleActive && (!hasInteracted || Date.now() - lastRealInput > IDLE_THRESHOLD_MS)){
    idleActive = true;
    enterIdleConfigShuffle(); // also initializes fresh idlePens
  }

  // gallery mode: build for gallerySeconds, dissolve over ~2.6s (the pen
  // rests while the piece fades), then restyle and begin the next piece
  let galleryHold = false;
  if (idleActive && ambient.gallery){
    const heldMs = Date.now() - galleryPhaseStart;
    if (!galleryFading){
      if (heldMs > (ambient.gallerySeconds || 45) * 1000){
        galleryFading = true;
        galleryPhaseStart = Date.now();
      }
    } else {
      galleryHold = true;
      fadePass(14);
      if (heldMs > 2600){
        clearArt(); // hard clear so no faint residue survives into the next piece
        galleryFading = false;
        galleryPhaseStart = Date.now();
        applyCosmeticConfig(randomCosmeticConfig());
        pickIdlePathAlgorithms();
      }
    }
  }

  if (idleActive){
    if (!galleryHold) stepIdleDrawing();
  } else if (lastX !== null && !shiftDown && !twoFingerTilt){
    // Shift (camera tilt) and two-finger gestures pause drawing entirely;
    // lastX resets on release so no stroke bridges the gap
    if (!mouseOverUI && (mouseX !== lastX || mouseY !== lastY)){
      drawMandalaStroke(lastX, lastY, mouseX, mouseY);
    }
    lastX = mouseX; lastY = mouseY;
  }

  // after input so points laid this frame are already part of the rope
  silkFrame();

  flushBatches();
  present();
}

// ---------- idle path algorithms (identical logic to sketch.js) ----------
function computeIdleStep(pen, speedEnvelope, cx, cy, maxRX, maxRY){
  let nx, ny;

  if (pen.algorithm === 'rose'){
    pen.dirAngle += 0.014 * speedEnvelope;
    pen.pulseT += 0.0018 * speedEnvelope;
    const petals = 2 + noise(pen.pulseT) * 4;
    const roseFactor = abs(cos(petals * pen.dirAngle));
    const radiusJitter = (noise(pen.pulseT * 5, 900) - 0.5) * 0.3;
    const distFactor = constrain(0.1 + roseFactor * 0.9 + radiusJitter, 0.05, 1);
    nx = cx + cos(pen.dirAngle) * maxRX * distFactor;
    ny = cy + sin(pen.dirAngle) * maxRY * distFactor;

  } else if (pen.algorithm === 'spiral'){
    pen.dirAngle += 0.012 * speedEnvelope;
    pen.pulseT += 0.0025 * speedEnvelope;
    const radiusJitter = (noise(pen.pulseT * 5, 3000) - 0.5) * 0.15;
    const distFactor = constrain(0.05 + noise(pen.pulseT) * 0.95 + radiusJitter, 0.02, 1);
    nx = cx + cos(pen.dirAngle) * maxRX * distFactor;
    ny = cy + sin(pen.dirAngle) * maxRY * distFactor;

  } else if (pen.algorithm === 'lissajous'){
    pen.pulseT += 0.006 * speedEnvelope;
    const freqX = 1.2 + noise(pen.pulseT) * 1.2;
    const freqY = 1.6 + noise(pen.pulseT + 700) * 1.2;
    const jitterX = (noise(pen.pulseT * 5, 2000) - 0.5) * 0.25;
    const jitterY = (noise(pen.pulseT * 5, 2600) - 0.5) * 0.25;
    nx = cx + constrain(sin(pen.pulseT * freqX) + jitterX, -1, 1) * maxRX;
    ny = cy + constrain(sin(pen.pulseT * freqY + PI / 3) + jitterY, -1, 1) * maxRY;

  } else if (pen.algorithm === 'epicycle'){
    // spirograph: two arms spinning at different, slowly drifting rates —
    // the ratio between them decides the loop pattern, and letting it
    // drift means the loops never quite close the same way twice
    pen.dirAngle += 0.011 * speedEnvelope;
    pen.pulseT += 0.011 * (2.2 + noise(pen.dirAngle * 0.05, 600) * 1.6) * speedEnvelope;
    nx = cx + (cos(pen.dirAngle) * 0.62 + cos(pen.pulseT) * 0.34) * maxRX;
    ny = cy + (sin(pen.dirAngle) * 0.62 + sin(pen.pulseT) * 0.34) * maxRY;

  } else if (pen.algorithm === 'lemniscate'){
    // figure-eight that slowly spins whole and breathes in size — with
    // symmetry the two lobes multiply into petal clusters
    pen.pulseT += 0.008 * speedEnvelope;
    pen.dirAngle += 0.0012 * speedEnvelope;
    const scale = 0.5 + noise(pen.pulseT * 0.4, 1500) * 0.5;
    const lx = sin(pen.pulseT) * scale;
    const ly = sin(pen.pulseT) * cos(pen.pulseT) * scale * 1.4;
    const cA = cos(pen.dirAngle), sA = sin(pen.dirAngle);
    nx = cx + (lx * cA - ly * sA) * maxRX;
    ny = cy + (lx * sA + ly * cA) * maxRY;

  } else if (pen.algorithm === 'wave'){
    // full-width sine sweeps: the pen glides side to side while its height
    // undulates at a drifting frequency — with symmetry this weaves a
    // lattice/web rather than a flower
    pen.pulseT += 0.007 * speedEnvelope;
    const sweep = sin(pen.pulseT * 0.6);
    const freq = 2.4 + noise(pen.pulseT * 0.3, 800) * 1.8;
    const amp = 0.3 + noise(pen.pulseT * 0.2, 1900) * 0.45;
    nx = cx + sweep * maxRX;
    ny = cy + sin(pen.pulseT * freq) * amp * maxRY;

  } else {
    pen.pulseT += 0.006 * speedEnvelope;
    const px = pen.x === null ? cx : pen.x;
    const py = pen.y === null ? cy : pen.y;
    const wanderAngle = noise(pen.pulseT, 500) * TWO_PI * 3;
    const toCenterX = cx - px, toCenterY = cy - py;
    const distFromCenter = hypot(toCenterX, toCenterY) || 1;
    const maxDrift = min(maxRX, maxRY);
    const pull = constrain(distFromCenter / maxDrift, 0, 1) * 0.6;
    const dirX = cos(wanderAngle) * (1 - pull) + (toCenterX / distFromCenter) * pull;
    const dirY = sin(wanderAngle) * (1 - pull) + (toCenterY / distFromCenter) * pull;
    const step = 3.2 * speedEnvelope;
    nx = px + dirX * step;
    ny = py + dirY * step;
  }

  return { nx, ny };
}

function stepIdleDrawing(){
  idleSpeedT += 0.003;
  const speedEnvelope = (0.35 + noise(idleSpeedT) * 0.5) * (idlePace / 100);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const maxRX = (canvas.width / 2) * 0.97;
  const maxRY = (canvas.height / 2) * 0.97;

  for (const pen of idlePens){
    const { nx, ny } = computeIdleStep(pen, speedEnvelope, cx, cy, maxRX, maxRY);

    if (pen.x === null){
      pen.x = nx; pen.y = ny;
      continue;
    }

    drawMandalaStroke(pen.x, pen.y, nx, ny);
    pen.x = nx; pen.y = ny;
  }
}

// ---------- stroke drawing ----------
function paletteHue(t){
  const range = paletteRange();
  return (range[0] + t * (range[1] - range[0])) % 360;
}

// rainbow/gradient stroke colour for a 0..1 position — named palettes map
// through a hue range at fixed saturation; the custom palette blends the
// user's actual stops (their saturation/brightness included)
function strokeColourFromT(t){
  if (palette === 'custom'){
    const c = hexToHSB(customPaletteHex(t));
    return { h: c.h, s: c.s, b: c.b, a: strokeAlpha };
  }
  return { h: paletteHue(t), s: 75, b: 100, a: strokeAlpha };
}

function drawMandalaStroke(x1, y1, x2, y2){
  // continuing an existing stroke? (its start is where a stroke ended last
  // frame — mouse path and each idle pen all match on exact coordinates).
  // Slot 2 records whether that frame actually laid ink: after a dashed
  // gap the next dash starts fresh instead of bridging the gap.
  const prev = prevStrokeEnds.find((p) => p[0] === x1 && p[1] === y1);
  const continuing = !!prev && prev[2] === 1;

  // a continuing segment anchors to where the previous one actually ended
  // IN THE BUFFER (carried in prev[3..4]): re-unprojecting the old screen
  // point through the new rotation/camera lands where the ink isn't anymore,
  // which tore visible gaps into strokes whenever the canvas was spinning
  const p1 = continuing ? { x: prev[3], y: prev[4] } : toBufferSpace(x1, y1);
  const p2 = toBufferSpace(x2, y2);
  const cx = bufferSize / 2, cy = bufferSize / 2;
  const dx = p2.x - cx, dy = p2.y - cy;
  const pdx = p1.x - cx, pdy = p1.y - cy;
  const speed = hypot(x2 - x1, y2 - y1);

  // silk lays no ink here — the pointer only feeds points into a rope, and
  // silkFrame() draws the living rope every frame (even after input stops)
  if (strokeStyleMode === 'silk'){
    curStrokeEnds.push([x2, y2, 1, p2.x, p2.y]);
    silkAddPoint(x1, y1, x2, y2, p1, p2);
    return;
  }

  // dashed style: ink pulses on and off on a frame clock — slow movement
  // gives fine stitching, fast movement long dashes. Gap frames still
  // record the pen position (drawn flag 0) so drawing resumes cleanly.
  if (strokeStyleMode === 'dashed' && floor(frameCount / 4) % 2 === 1){
    curStrokeEnds.push([x2, y2, 0, p2.x, p2.y]);
    return;
  }

  let sw = brushSize + (reactToSpeed ? min(speed * 0.6, 22) : 0);
  if (pulseBrush){
    sw += sin(frameCount * 0.12) * (brushSize * 0.5);
    sw = max(sw, 1);
  }
  if (strokeStyleMode === 'taper'){
    // calligraphy: pressure ~ dwell — slow strokes press wide, fast flicks
    // thin to a hairline
    sw = max(sw * (1.5 - min(speed, 36) * 0.036), 0.6);
  }

  let strokeColour; // {h,s,b,a} — alpha on p5's 0..100 scale
  if (colourMode === 'rainbow'){
    const t = ((hueShift + (reactToSpeed ? speed * 4 : 0)) % 360) / 360;
    strokeColour = strokeColourFromT(t);
    hueShift = (hueShift + rainbowSpeed) % 360;
  } else if (colourMode === 'gradient'){
    const d = hypot(dx, dy);
    const maxD = hypot(cx, cy);
    const t = constrain(d / maxD, 0, 1);
    strokeColour = strokeColourFromT(t);
  } else {
    strokeColour = hexToHSB(solidColourHex);
    strokeColour.a = strokeAlpha;
  }

  // stamped styles (sparkle/rings/petals) drop one shape per frame at the
  // cursor, exactly like stippled dots: move slowly and the shapes overlap
  // into a solid line, move fast and they spread out into separate stamps
  curStrokeEnds.push([x2, y2, 1, p2.x, p2.y]);

  // kaleidoscope: fold both endpoints into a single wedge before
  // replicating — strokes visibly "bounce" off the wedge walls, exactly
  // like the object chamber of a physical kaleidoscope
  let P1x = pdx, P1y = pdy, P2x = dx, P2y = dy;
  if (symmetryMode === 'kaleido'){
    const wedge = TWO_PI / max(symmetry, 1);
    const fold = (x, y) => {
      const r = hypot(x, y);
      let a = ((Math.atan2(y, x) % (2 * wedge)) + 2 * wedge) % (2 * wedge);
      if (a > wedge) a = 2 * wedge - a;
      return { x: r * cos(a), y: r * sin(a) };
    };
    const f1 = fold(P1x, P1y), f2 = fold(P2x, P2y);
    P1x = f1.x; P1y = f1.y; P2x = f2.x; P2y = f2.y;
  }

  if (symmetryMode === 'grid'){
    // tiled wallpaper: the whole drawing shrinks into each cell, flipped
    // checkerboard-fashion so adjacent tiles reflect into each other
    const cells = constrain(round(Math.sqrt(symmetry)), 2, 6);
    const tile = bufferSize / cells;
    const s = 1 / cells;
    for (let gy = 0; gy < cells; gy++){
      for (let gx = 0; gx < cells; gx++){
        const offX = (gx + 0.5) * tile - cx;
        const offY = (gy + 0.5) * tile - cy;
        const fx = (gx + gy) % 2 === 1 ? -1 : 1;
        drawArm(P1x * fx, P1y, P2x * fx, P2y, sw, strokeColour, cx, cy, 1, 0, false, continuing, s, offX, offY);
        if (mirror){
          drawArm(P1x * fx, P1y, P2x * fx, P2y, sw, strokeColour, cx, cy, 1, 0, true, continuing, s, offX, offY);
        }
      }
    }
    return;
  }

  const angleStep = TWO_PI / symmetry;
  // kaleidoscope needs the reflected copy regardless of the mirror
  // checkbox — alternating reflection is what closes the wedge pattern
  const bothSides = mirror || symmetryMode === 'kaleido';
  let ang = 0;
  for (let i = 0; i < symmetry; i++){
    ang += angleStep;
    const cosA = cos(ang), sinA = sin(ang);
    // spiral shells: each copy also shrinks, reaching ~35% after a full turn
    const sc = symmetryMode === 'spiral' ? Math.pow(0.35, i / symmetry) : 1;
    drawArm(P1x, P1y, P2x, P2y, sw, strokeColour, cx, cy, cosA, sinA, false, continuing, sc, 0, 0);
    if (bothSides){
      drawArm(P1x, P1y, P2x, P2y, sw, strokeColour, cx, cy, cosA, sinA, true, continuing, sc, 0, 0);
    }
  }
}

// one symmetry arm: rotate/mirror local coords into art-buffer world space
// on the CPU. sc scales the copy about its own origin (spiral shells, grid
// tiles); offX/offY relocate that origin (grid cell centres).
function drawArm(pdx, pdy, dx, dy, sw, col, cx, cy, cosA, sinA, mirrored, continuing, sc = 1, offX = 0, offY = 0){
  if (mirrored){ pdy = -pdy; dy = -dy; }
  sw *= sc;
  const ax = cx + (pdx * cosA - pdy * sinA) * sc + offX;
  const ay = cy + (pdx * sinA + pdy * cosA) * sc + offY;
  const bx = cx + (dx * cosA - dy * sinA) * sc + offX;
  const by = cy + (dx * sinA + dy * cosA) * sc + offY;

  // world space directly (the p5 version spawns in arm-local space and
  // converts through the active canvas transform — same end result)
  maybeSpawnParticles(bx, by, col);

  const [r, g, b] = hsbToRgb(col.h, col.s, col.b);
  const a = col.a / 100;
  const glow = glowIntensity;
  const cap = continuing ? 0 : 1;

  if (strokeStyleMode === 'line' || strokeStyleMode === 'taper' || strokeStyleMode === 'dashed'){
    // taper varies sw upstream; dashed gates whole frames upstream — all
    // three lay down the same plain round-capped segment here
    emitCapsule(ax, ay, bx, by, sw / 2, glow, r, g, b, a, cap);

  } else if (strokeStyleMode === 'chalk'){
    // a firm core plus two loose jittered passes — rough ink/charcoal.
    // The jittered passes get full caps: they never line up with last
    // frame's, so cap-subtraction would notch them instead of joining them
    const j = max(sw * 0.6, 2);
    emitCapsule(ax, ay, bx, by, max(sw * 0.7, 1) / 2, glow, r, g, b, a * 0.6, cap);
    emitCapsule(ax + random(-j, j), ay + random(-j, j), bx + random(-j, j), by + random(-j, j),
      max(sw * 0.3, 0.8) / 2, glow, r, g, b, a * 0.35, 1);
    emitCapsule(ax + random(-j, j), ay + random(-j, j), bx + random(-j, j), by + random(-j, j),
      max(sw * 0.3, 0.8) / 2, glow, r, g, b, a * 0.35, 1);

  } else if (strokeStyleMode === 'ribbon'){
    emitCapsule(ax, ay, bx, by, (sw * 2.2) / 2, glow, r, g, b, 0.28, cap);
    emitCapsule(ax, ay, bx, by, max(sw * 0.4, 1) / 2, glow, r, g, b, a, cap);

  } else if (strokeStyleMode === 'dots'){
    // dots/sparkles are stand-alone stamps — beading between them is the look
    emitCapsule(bx, by, bx, by, sw / 2, glow, r, g, b, a, 1);

  } else if (strokeStyleMode === 'sparkle'){
    // soft halo standing in for the star's shadowBlur, then the star itself
    // (minimum size so the 4-point shape stays legible at small brushes)
    const s = max(sw, 5);
    if (glow > 0){
      emitCapsule(bx, by, bx, by, 0, glow + s * 0.5, r, g, b, a, 1);
    }
    emitStar(bx, by, s * 0.5, s * 1.6, 4, r, g, b, a);

  } else if (strokeStyleMode === 'rails'){
    // two thin parallel lines riding either side of the stroke path (full
    // caps: the offset joints drift on curves, so cap-subtraction would
    // notch them instead of smoothing them)
    let ddx = bx - ax, ddy = by - ay;
    const dl = hypot(ddx, ddy);
    if (dl < 1e-6){ ddx = 1; ddy = 0; } else { ddx /= dl; ddy /= dl; }
    // minimum gap so the two rails read as two even at small brush sizes,
    // where the glow halos would otherwise fuse them into one line
    const off = max(sw * 0.9, 6);
    const ox = -ddy * off, oy = ddx * off;
    const railHw = max(sw * 0.35, 1) / 2;
    emitCapsule(ax + ox, ay + oy, bx + ox, by + oy, railHw, glow, r, g, b, a, 1);
    emitCapsule(ax - ox, ay - oy, bx - ox, by - oy, railHw, glow, r, g, b, a, 1);

  } else if (strokeStyleMode === 'rings'){
    emitCapsule(bx, by, bx, by, max(sw * 1.4, 8), glow, r, g, b, a, 2);

  } else if (strokeStyleMode === 'petals'){
    // an elongated stamp oriented along the motion direction
    let ddx = bx - ax, ddy = by - ay;
    const dl = hypot(ddx, ddy);
    if (dl < 1e-6){ ddx = 1; ddy = 0; } else { ddx /= dl; ddy /= dl; }
    const half = max(sw * 1.3, 8);
    emitCapsule(bx - ddx * half, by - ddy * half, bx + ddx * half, by + ddy * half,
      max(sw * 0.45, 1.5), glow, r, g, b, a, 1);
  }
}

// ---------- silk wisps engine (mirrors sketch.js) ----------
// feeds a pointer segment (buffer-space endpoints p1/p2) into the rope that
// has been following this input source, matching on raw input coords the
// same way prevStrokeEnds does — mouse and each idle pen each get their own
// rope, so double idle patterns don't zigzag into one another
function silkAddPoint(x1, y1, x2, y2, p1, p2){
  let rope = silkRopes.find((r) => r.lastInX === x1 && r.lastInY === y1);
  if (!rope){
    if (silkRopes.length >= SILK_MAX_ROPES) silkRopes.shift();
    rope = { pts: [], lastInX: x1, lastInY: y1 };
    silkRopes.push(rope);
  }
  rope.pts.push({
    x: p2.x, y: p2.y, px: p2.x, py: p2.y,
    ivx: p2.x - p1.x, ivy: p2.y - p1.y,
    life: SILK_POINT_LIFE
  });
  if (rope.pts.length > SILK_MAX_ROPE_POINTS) rope.pts.shift();
  rope.lastInX = x2;
  rope.lastInY = y2;
}

// one physics step, straight port of weavesilk's Silk.step: a noise-field
// force whose ANGLE comes from Perlin noise (rotated around the centre so
// wisps flow radially), a decaying launch push, then a constraint pass
// pulling neighbours together so the rope folds into sheets
function silkStepRope(rope){
  const cx = bufferSize / 2, cy = bufferSize / 2;
  const pts = rope.pts;
  while (pts.length && pts[0].life <= 0) pts.shift();
  for (let i = 0; i < pts.length; i++){
    const p = pts[i];
    const symAngle = Math.atan2(p.y - cy, p.x - cx);
    // this noise() is 2D — drifting the sample point over time stands in
    // for sketch.js's true 3D time axis, close enough for a force field
    const nv = noise(p.x * SILK_NOISE_SPACE + silkTime * SILK_NOISE_TIME,
                     p.y * SILK_NOISE_SPACE + silkTime * SILK_NOISE_TIME * 0.7);
    const na = SILK_NOISE_ANGLE * nv + symAngle;
    let accx = cos(na) + SILK_IVEL_FORCE * p.ivx;
    let accy = sin(na) + SILK_IVEL_FORCE * p.ivy;
    p.ivx *= SILK_IVEL_DECAY;
    p.ivy *= SILK_IVEL_DECAY;
    // px/py catch up to the post-move position, so the velocity term below
    // only ever carries last step's constraint correction — that soft
    // elastic memory is what weavesilk's cloth feel comes from
    p.x += (p.x - p.px) * SILK_FRICTION + accx;
    p.y += (p.y - p.py) * SILK_FRICTION + accy;
    p.px = p.x;
    p.py = p.y;
    p.life--;
    if (i){
      const p2 = pts[i - 1];
      const xoff = p2.x - p.x, yoff = p2.y - p.y;
      const d = Math.sqrt(xoff * xoff + yoff * yoff);
      if (d > 0.01){
        const fx = SILK_RIGIDITY * xoff, fy = SILK_RIGIDITY * yoff;
        p.x += fx; p2.x -= fx;
        p.y += fy; p2.y -= fy;
      }
    }
  }
}

// stroke colour for a rope through the normal colour engine ({h,s,b} — the
// ghost alpha is applied separately when the capsules are emitted)
function silkRopeColour(rope){
  if (colourMode === 'rainbow'){
    const t = (hueShift % 360) / 360;
    const c = strokeColourFromT(t);
    return { h: c.h, s: c.s, b: c.b };
  }
  if (colourMode === 'gradient'){
    const cx = bufferSize / 2, cy = bufferSize / 2;
    const newest = rope.pts[rope.pts.length - 1];
    const t = constrain(hypot(newest.x - cx, newest.y - cy) / hypot(cx, cy), 0, 1);
    const c = strokeColourFromT(t);
    return { h: c.h, s: c.s, b: c.b };
  }
  return hexToHSB(solidColourHex);
}

// one symmetry arm of a rope: transform every point like drawArm does and
// emit the chain into the additive silk batch. cap=0 on continuations so
// overlapping joint caps don't double-brighten under additive blending.
function silkEmitArm(pts, cosA, sinA, mirrored, sc, offX, offY, halfW, r, g, b, a){
  const cx = bufferSize / 2, cy = bufferSize / 2;
  const hw = halfW * sc;
  let prevX = 0, prevY = 0;
  for (let i = 0; i < pts.length; i++){
    let x = pts[i].x, y = mirrored ? -pts[i].y : pts[i].y;
    const wx = cx + (x * cosA - y * sinA) * sc + offX;
    const wy = cy + (x * sinA + y * cosA) * sc + offY;
    if (i) emitCapsule(prevX, prevY, wx, wy, hw, 0, r, g, b, a, i === 1 ? 1 : 0, silkVerts);
    prevX = wx; prevY = wy;
  }
}

// draw every rope through the same symmetry replication drawMandalaStroke
// uses, but into the additive batch at ghost alpha — once per physics step
function silkEmitRopes(){
  const cx = bufferSize / 2, cy = bufferSize / 2;
  const halfW = max(brushSize * 0.15, 0.7) / 2;

  for (const rope of silkRopes){
    if (rope.pts.length < 2) continue;

    let pts = rope.pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    if (symmetryMode === 'kaleido'){
      const wedge = TWO_PI / max(symmetry, 1);
      pts = pts.map((p) => {
        const rr = hypot(p.x, p.y);
        let ang = ((Math.atan2(p.y, p.x) % (2 * wedge)) + 2 * wedge) % (2 * wedge);
        if (ang > wedge) ang = 2 * wedge - ang;
        return { x: rr * cos(ang), y: rr * sin(ang) };
      });
    }

    const col = silkRopeColour(rope);
    const [r, g, b] = hsbToRgb(col.h, col.s, col.b);
    // strokeAlpha 92 ≈ weavesilk's 0.09 per pass; the newest point's life
    // fraction fades the whole rope out once input stops feeding it
    const a = (strokeAlpha / 1000) * (rope.pts[rope.pts.length - 1].life / SILK_POINT_LIFE);

    if (symmetryMode === 'grid'){
      const cells = constrain(round(Math.sqrt(symmetry)), 2, 6);
      const tile = bufferSize / cells;
      const s = 1 / cells;
      for (let gy = 0; gy < cells; gy++){
        for (let gx = 0; gx < cells; gx++){
          const offX = (gx + 0.5) * tile - cx;
          const offY = (gy + 0.5) * tile - cy;
          const fx = (gx + gy) % 2 === 1 ? -1 : 1;
          const flipped = fx === -1 ? pts.map((p) => ({ x: -p.x, y: p.y })) : pts;
          silkEmitArm(flipped, 1, 0, false, s, offX, offY, halfW, r, g, b, a);
          if (mirror) silkEmitArm(flipped, 1, 0, true, s, offX, offY, halfW, r, g, b, a);
        }
      }
    } else {
      const angleStep = TWO_PI / symmetry;
      const bothSides = mirror || symmetryMode === 'kaleido';
      let ang = 0;
      for (let i = 0; i < symmetry; i++){
        ang += angleStep;
        const cosA = cos(ang), sinA = sin(ang);
        const sc = symmetryMode === 'spiral' ? Math.pow(0.35, i / symmetry) : 1;
        silkEmitArm(pts, cosA, sinA, false, sc, 0, 0, halfW, r, g, b, a);
        if (bothSides) silkEmitArm(pts, cosA, sinA, true, sc, 0, 0, halfW, r, g, b, a);
      }
    }
  }
}

// per-frame silk pass: run the physics and lay a ghost of every rope after
// each step. Ropes keep flowing (and fading) after input stops; switching
// away from the silk brush drops them instantly.
function silkFrame(){
  if (strokeStyleMode !== 'silk'){
    if (silkRopes.length) silkRopes = [];
    return;
  }
  silkRopes = silkRopes.filter((r) => r.pts.length);
  if (!silkRopes.length) return;
  if (colourMode === 'rainbow') hueShift = (hueShift + rainbowSpeed) % 360;
  for (let s = 0; s < SILK_STEPS_PER_FRAME; s++){
    silkTime++;
    for (const rope of silkRopes) silkStepRope(rope);
    silkEmitRopes();
  }
}

function maybeSpawnParticles(worldX, worldY, col){
  if (!sparkleDust) return;
  const count = floor(random(1, 3));
  for (let i = 0; i < count; i++){
    particles.push({
      x: worldX + random(-6, 6),
      y: worldY + random(-6, 6),
      vx: random(-0.3, 0.3),
      vy: random(-0.7, -0.2),
      life: 255,
      col
    });
  }
}

function updateAndDrawParticles(){
  if (particles.length === 0) return;
  for (let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.life -= 6;
    if (p.life <= 0){ particles.splice(i, 1); continue; }
    const [r, g, b] = hsbToRgb(p.col.h, p.col.s, p.col.b);
    emitCapsule(p.x, p.y, p.x, p.y, 1.5, 0, r, g, b, (p.life / 255) * 0.9, 1);
  }
}

// ---------- resize / context loss / save ----------
function onResize(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  bufferSize = computeBufferSize();
  if (!contextLost){
    createArtTarget(bufferSize);
    clearArt();
  }
  lastX = null; lastY = null;
}

function saveImage(){
  // render a fresh frame and read it back synchronously in the same task —
  // no need for preserveDrawingBuffer that way
  present();
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'mandala.png';
  a.click();
}

// ---------- state load (from storage; mirrors sketch.js) ----------
function applyMandalaState(m){
  const $ = (id) => document.getElementById(id);
  symmetry = m.symmetry; $('symmetry').value = symmetry; $('symmetryVal').textContent = symmetry;
  mirror = m.mirror; $('mirror').checked = mirror;
  brushSize = m.brushSize; $('brush').value = brushSize; $('brushVal').textContent = brushSize;
  reactToSpeed = m.reactToSpeed; $('reactSpeed').checked = reactToSpeed;
  colourMode = m.colourMode; $('colourMode').value = colourMode;
  solidColourHex = m.solidColourHex; $('solidColor').value = solidColourHex;
  symmetryMode = m.symmetryMode || 'radial'; $('symmetryMode').value = symmetryMode;
  customPalette = (m.customPalette && m.customPalette.length >= 2) ? m.customPalette.slice() : customPalette;
  trailMode = m.trailMode;
  document.querySelector('input[name="trail"][value="' + trailMode + '"]').checked = true;
  fadeSpeed = m.fadeSpeed; $('fadeSpeed').value = fadeSpeed; $('fadeVal').textContent = fadeSpeed;
  cycleBuildSeconds = m.cycleBuildSeconds; $('cycleBuildSeconds').value = cycleBuildSeconds; $('cycleBuildVal').textContent = cycleBuildSeconds + 's';
  bgColourHex = m.bgColourHex; $('bgColorPicker').value = bgColourHex;
  bgColour = hexToHSB(bgColourHex);
  applyThemeFromBg(bgColourHex);
  palette = m.palette; $('palette').value = palette;
  renderCustomSwatches();
  syncPaletteUI($);
  glowIntensity = m.glowIntensity; $('glow').value = glowIntensity; $('glowVal').textContent = glowIntensity;
  pulseBrush = m.pulseBrush; $('pulseBrush').checked = pulseBrush;
  strokeStyleMode = m.strokeStyleMode; $('strokeStyle').value = strokeStyleMode;
  autoRotate = m.autoRotate; $('autoRotate').checked = autoRotate;
  rotateSpeed = m.rotateSpeed; userRotateSpeed = rotateSpeed;
  $('rotateSpeed').value = rotateSpeed; $('rotateVal').textContent = rotateSpeed.toFixed(2);
  sparkleDust = m.sparkleDust; $('sparkleDust').checked = sparkleDust;
  idleDraw = m.idleDraw; $('idleDraw').checked = idleDraw;
  doubleIdlePattern = m.doubleIdlePattern; $('doubleIdlePattern').checked = doubleIdlePattern;
  strokeAlpha = m.strokeAlpha; $('strokeAlpha').value = strokeAlpha; $('strokeAlphaVal').textContent = strokeAlpha;
  rainbowSpeed = m.rainbowSpeed; $('rainbowSpeed').value = rainbowSpeed; $('rainbowSpeedVal').textContent = rainbowSpeed.toFixed(1);
  idlePace = m.idlePace; $('idlePace').value = idlePace; $('idlePaceVal').textContent = idlePace + '%';
  idleShuffleSeconds = m.idleShuffleSeconds; $('idleShuffleSeconds').value = idleShuffleSeconds; $('idleShuffleVal').textContent = idleShuffleSeconds + 's';
  depthAmount = m.depthAmount; $('depthAmount').value = depthAmount; $('depthVal').textContent = depthAmount;
  depthDrift = m.depthDrift; $('depthDrift').checked = depthDrift;

  $('solidColorGroup').style.display = colourMode === 'solid' ? 'block' : 'none';
  $('paletteGroup').style.display = colourMode === 'solid' ? 'none' : 'block';
  $('rainbowSpeedGroup').style.display = colourMode === 'rainbow' ? 'block' : 'none';
  $('fadeGroup').style.display = (trailMode === 'fade' || trailMode === 'cycle') ? 'block' : 'none';
  $('cycleGroup').style.display = trailMode === 'cycle' ? 'block' : 'none';
  $('rotateGroup').style.display = autoRotate ? 'block' : 'none';
  if (trailMode === 'cycle') resetCyclePhase();

  // with instant-on ambient drawing, state can load while the idle shuffle
  // is already running — refresh the captured "restore on wake" config to
  // the loaded one and re-roll the ambient look on top of it
  if (idleActive && idlePrevConfig){
    idlePrevConfig = captureCosmeticConfig();
    applyCosmeticConfig(randomCosmeticConfig());
  }

  // repaint the trail buffer in the loaded background colour (main.js does
  // this for the p5 path; here the renderer owns it)
  if (gl && !contextLost){
    clearArt();
  }
  lastX = null; lastY = null;
}

function currentMandalaState(){
  return {
    symmetry, mirror, symmetryMode, brushSize, reactToSpeed, colourMode, solidColourHex,
    trailMode, fadeSpeed, cycleBuildSeconds, bgColourHex, palette, glowIntensity, pulseBrush,
    customPalette: customPalette.slice(),
    strokeStyleMode, autoRotate, rotateSpeed, sparkleDust, idleDraw,
    doubleIdlePattern, strokeAlpha, rainbowSpeed, idlePace, idleShuffleSeconds,
    depthAmount, depthDrift
  };
}

function saveMandalaState(){
  MandalaStorage.patch('mandala', currentMandalaState());
}

// the custom-palette editor only makes sense while a hue-driven colour mode
// is active AND the custom palette is the one selected
function syncPaletteUI($){
  $('customPaletteGroup').style.display =
    (palette === 'custom' && colourMode !== 'solid') ? 'block' : 'none';
}

// rebuilds the swatch editor: one colour well per stop, plus +/− steppers
// (2 to 5 stops)
function renderCustomSwatches(){
  const wrap = document.getElementById('customSwatches');
  wrap.textContent = '';
  customPalette.forEach((hex, i) => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = hex;
    input.addEventListener('input', () => { customPalette[i] = input.value; saveMandalaState(); });
    wrap.appendChild(input);
  });
  if (customPalette.length > 2){
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '−'; del.dataset.tip = 'Remove the last color';
    del.addEventListener('click', () => { customPalette.pop(); renderCustomSwatches(); saveMandalaState(); });
    wrap.appendChild(del);
  }
  if (customPalette.length < 5){
    const add = document.createElement('button');
    add.type = 'button'; add.textContent = '+'; add.dataset.tip = 'Add another color (up to five)';
    add.addEventListener('click', () => { customPalette.push('#f2c14e'); renderCustomSwatches(); saveMandalaState(); });
    wrap.appendChild(add);
  }
}

// called by breathing.js to temporarily drive the rotation, and to hand it back
function setBreathingRotate(active, speed){
  breathingActive = active;
  if (active){
    rotateSpeed = speed;
  } else {
    rotateSpeed = userRotateSpeed;
    const $ = (id) => document.getElementById(id);
    $('rotateVal').textContent = rotateSpeed.toFixed(2);
    $('rotateSpeed').value = rotateSpeed;
  }
}

// ---------- presets (identical to sketch.js) ----------
const PRESETS = {
  neon: { symmetry: 16, mirror: true, strokeStyleMode: 'line', colourMode: 'rainbow', palette: 'full', glowIntensity: 18, trailMode: 'fade', fadeSpeed: 10 },
  gold: { symmetry: 8, mirror: true, strokeStyleMode: 'ribbon', colourMode: 'solid', solidColourHex: '#f2c14e', glowIntensity: 14, trailMode: 'permanent' },
  ocean: { symmetry: 24, mirror: false, strokeStyleMode: 'dots', colourMode: 'gradient', palette: 'ocean', glowIntensity: 12, trailMode: 'fade', fadeSpeed: 6 },
  chaosBloom: { symmetry: 10, mirror: true, strokeStyleMode: 'sparkle', colourMode: 'rainbow', palette: 'sunset', glowIntensity: 20, trailMode: 'fade', fadeSpeed: 14 },
  // twinkling champagne stars that pulse and shed dust
  stardust: { symmetry: 20, mirror: true, strokeStyleMode: 'sparkle', colourMode: 'solid', solidColourHex: '#fff3c4', brushSize: 2, glowIntensity: 24, strokeAlpha: 100, sparkleDust: true, pulseBrush: true, trailMode: 'fade', fadeSpeed: 4, autoRotate: true, rotateSpeed: 0.08 },
  // thin fast-cycling beams, quick fade, fast spin — a light show
  laserRave: { symmetry: 8, mirror: true, strokeStyleMode: 'line', colourMode: 'rainbow', palette: 'full', rainbowSpeed: 3, brushSize: 2, glowIntensity: 26, strokeAlpha: 100, reactToSpeed: true, pulseBrush: false, sparkleDust: false, trailMode: 'fade', fadeSpeed: 32, autoRotate: true, rotateSpeed: 1.2 },
  // hairline pale strokes that build forever, no glow, no spin — etching
  zenInk: { symmetry: 6, mirror: true, strokeStyleMode: 'line', colourMode: 'solid', solidColourHex: '#f4f1ea', brushSize: 1, glowIntensity: 0, strokeAlpha: 55, reactToSpeed: false, pulseBrush: false, sparkleDust: false, trailMode: 'permanent', autoRotate: false },
  // wide translucent green curtains that linger and breathe
  aurora: { symmetry: 4, mirror: true, strokeStyleMode: 'ribbon', colourMode: 'gradient', palette: 'forest', brushSize: 9, glowIntensity: 16, strokeAlpha: 60, pulseBrush: true, sparkleDust: false, trailMode: 'fade', fadeSpeed: 3, autoRotate: true, rotateSpeed: 0.1 },
  // warm green-gold motes drifting with dust trails
  fireflies: { symmetry: 12, mirror: false, strokeStyleMode: 'dots', colourMode: 'gradient', palette: 'forest', brushSize: 3, glowIntensity: 22, strokeAlpha: 85, pulseBrush: true, sparkleDust: true, trailMode: 'fade', fadeSpeed: 7, autoRotate: true, rotateSpeed: 0.15 },
  // fat pastel candy dots that build up and melt away in cycles
  bubblegum: { symmetry: 14, mirror: true, strokeStyleMode: 'dots', colourMode: 'rainbow', palette: 'sunset', rainbowSpeed: 1.4, brushSize: 11, glowIntensity: 8, strokeAlpha: 70, pulseBrush: true, sparkleDust: false, trailMode: 'cycle', autoRotate: true, rotateSpeed: 0.25 }
};

function applyPreset(name){
  const p = PRESETS[name];
  if (!p) return;
  const $ = (id) => document.getElementById(id);

  if (p.symmetry !== undefined){ symmetry = p.symmetry; $('symmetry').value = symmetry; $('symmetryVal').textContent = symmetry; }
  if (p.mirror !== undefined){ mirror = p.mirror; $('mirror').checked = mirror; }
  if (p.symmetryMode !== undefined){ symmetryMode = p.symmetryMode; $('symmetryMode').value = symmetryMode; }
  if (p.strokeStyleMode !== undefined){ strokeStyleMode = p.strokeStyleMode; $('strokeStyle').value = strokeStyleMode; }
  if (p.colourMode !== undefined){
    colourMode = p.colourMode; $('colourMode').value = colourMode;
    $('solidColorGroup').style.display = colourMode === 'solid' ? 'block' : 'none';
    $('paletteGroup').style.display = colourMode === 'solid' ? 'none' : 'block';
    $('rainbowSpeedGroup').style.display = colourMode === 'rainbow' ? 'block' : 'none';
    syncPaletteUI($);
  }
  if (p.palette !== undefined){ palette = p.palette; $('palette').value = palette; syncPaletteUI($); }
  if (p.solidColourHex !== undefined){ solidColourHex = p.solidColourHex; $('solidColor').value = solidColourHex; }
  if (p.glowIntensity !== undefined){ glowIntensity = p.glowIntensity; $('glow').value = glowIntensity; $('glowVal').textContent = glowIntensity; }
  if (p.trailMode !== undefined){
    trailMode = p.trailMode;
    const radio = document.querySelector('input[name="trail"][value="' + trailMode + '"]');
    if (radio) radio.checked = true;
    $('fadeGroup').style.display = (trailMode === 'fade' || trailMode === 'cycle') ? 'block' : 'none';
    $('cycleGroup').style.display = trailMode === 'cycle' ? 'block' : 'none';
    if (trailMode === 'cycle') resetCyclePhase();
  }
  if (p.fadeSpeed !== undefined){ fadeSpeed = p.fadeSpeed; $('fadeSpeed').value = fadeSpeed; $('fadeVal').textContent = fadeSpeed; }
  if (p.brushSize !== undefined){ brushSize = p.brushSize; $('brush').value = brushSize; $('brushVal').textContent = brushSize; }
  if (p.pulseBrush !== undefined){ pulseBrush = p.pulseBrush; $('pulseBrush').checked = pulseBrush; }
  if (p.sparkleDust !== undefined){ sparkleDust = p.sparkleDust; $('sparkleDust').checked = sparkleDust; }
  if (p.reactToSpeed !== undefined){ reactToSpeed = p.reactToSpeed; $('reactSpeed').checked = reactToSpeed; }
  if (p.strokeAlpha !== undefined){ strokeAlpha = p.strokeAlpha; $('strokeAlpha').value = strokeAlpha; $('strokeAlphaVal').textContent = strokeAlpha; }
  if (p.rainbowSpeed !== undefined){ rainbowSpeed = p.rainbowSpeed; $('rainbowSpeed').value = rainbowSpeed; $('rainbowSpeedVal').textContent = rainbowSpeed.toFixed(1); }
  if (p.autoRotate !== undefined){ autoRotate = p.autoRotate; $('autoRotate').checked = autoRotate; $('rotateGroup').style.display = autoRotate ? 'block' : 'none'; }
  if (p.rotateSpeed !== undefined){
    rotateSpeed = p.rotateSpeed; userRotateSpeed = rotateSpeed;
    $('rotateSpeed').value = rotateSpeed; $('rotateVal').textContent = rotateSpeed.toFixed(2);
  }
  saveMandalaState();
}

// ---------- panel wiring (identical to sketch.js apart from renderer calls) ----------
function wireUpPanel(){
  const $ = (id) => document.getElementById(id);

  const panel = $('panel');
  const toggle = $('panel-toggle');

  // any interaction with a panel control is real user input — wake ambient
  // mode BEFORE the control's own handler runs (capture phase), or the
  // shuffle's restore-on-wake clobbers the change that was just made.
  // Concrete case: Firefox's colour picker is an OS-level dialog, so the
  // page sees no mouse events while it's open, ambient mode starts, and
  // the picked colour used to be reverted the moment the mouse moved.
  const wakeFromAmbient = () => {
    lastRealInput = Date.now();
    hasInteracted = true;
    if (idleActive){
      idleActive = false;
      lastX = null; lastY = null;
      exitIdleConfigShuffle();
    }
  };
  ['pointerdown', 'input', 'change'].forEach((evt) => {
    panel.addEventListener(evt, wakeFromAmbient, true);
  });

  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    MandalaStorage.patch('panelCollapsed', collapsed);
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  $('symmetry').addEventListener('input', (e) => {
    symmetry = parseInt(e.target.value, 10);
    $('symmetryVal').textContent = symmetry;
    saveMandalaState();
  });

  $('mirror').addEventListener('change', (e) => { mirror = e.target.checked; saveMandalaState(); });

  $('symmetryMode').addEventListener('change', (e) => { symmetryMode = e.target.value; saveMandalaState(); });

  $('strokeStyle').addEventListener('change', (e) => { strokeStyleMode = e.target.value; saveMandalaState(); });

  $('brush').addEventListener('input', (e) => {
    brushSize = parseInt(e.target.value, 10);
    $('brushVal').textContent = brushSize;
    saveMandalaState();
  });

  $('reactSpeed').addEventListener('change', (e) => { reactToSpeed = e.target.checked; saveMandalaState(); });
  $('pulseBrush').addEventListener('change', (e) => { pulseBrush = e.target.checked; saveMandalaState(); });
  $('sparkleDust').addEventListener('change', (e) => { sparkleDust = e.target.checked; saveMandalaState(); });
  $('idleDraw').addEventListener('change', (e) => { idleDraw = e.target.checked; saveMandalaState(); });
  $('doubleIdlePattern').addEventListener('change', (e) => { doubleIdlePattern = e.target.checked; saveMandalaState(); });

  $('autoRotate').addEventListener('change', (e) => {
    autoRotate = e.target.checked;
    $('rotateGroup').style.display = autoRotate ? 'block' : 'none';
    saveMandalaState();
  });

  $('rotateSpeed').addEventListener('input', (e) => {
    rotateSpeed = parseFloat(e.target.value);
    userRotateSpeed = rotateSpeed;
    $('rotateVal').textContent = rotateSpeed.toFixed(2);
    saveMandalaState();
  });

  $('colourMode').addEventListener('change', (e) => {
    colourMode = e.target.value;
    $('solidColorGroup').style.display = colourMode === 'solid' ? 'block' : 'none';
    $('paletteGroup').style.display = colourMode === 'solid' ? 'none' : 'block';
    $('rainbowSpeedGroup').style.display = colourMode === 'rainbow' ? 'block' : 'none';
    syncPaletteUI($);
    saveMandalaState();
  });

  $('palette').addEventListener('change', (e) => { palette = e.target.value; syncPaletteUI($); saveMandalaState(); });
  $('solidColor').addEventListener('input', (e) => { solidColourHex = e.target.value; saveMandalaState(); });

  $('glow').addEventListener('input', (e) => {
    glowIntensity = parseInt(e.target.value, 10);
    $('glowVal').textContent = glowIntensity;
    saveMandalaState();
  });

  $('strokeAlpha').addEventListener('input', (e) => {
    strokeAlpha = parseInt(e.target.value, 10);
    $('strokeAlphaVal').textContent = strokeAlpha;
    saveMandalaState();
  });

  $('rainbowSpeed').addEventListener('input', (e) => {
    rainbowSpeed = parseFloat(e.target.value);
    $('rainbowSpeedVal').textContent = rainbowSpeed.toFixed(1);
    saveMandalaState();
  });

  $('idlePace').addEventListener('input', (e) => {
    idlePace = parseInt(e.target.value, 10);
    $('idlePaceVal').textContent = idlePace + '%';
    saveMandalaState();
  });

  $('idleShuffleSeconds').addEventListener('input', (e) => {
    idleShuffleSeconds = parseInt(e.target.value, 10);
    $('idleShuffleVal').textContent = idleShuffleSeconds + 's';
    saveMandalaState();
  });

  document.querySelectorAll('input[name="trail"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      trailMode = e.target.value;
      $('fadeGroup').style.display = (trailMode === 'fade' || trailMode === 'cycle') ? 'block' : 'none';
      $('cycleGroup').style.display = trailMode === 'cycle' ? 'block' : 'none';
      if (trailMode === 'cycle') resetCyclePhase();
      saveMandalaState();
    });
  });

  $('fadeSpeed').addEventListener('input', (e) => {
    fadeSpeed = parseInt(e.target.value, 10);
    $('fadeVal').textContent = fadeSpeed;
    saveMandalaState();
  });

  $('cycleBuildSeconds').addEventListener('input', (e) => {
    cycleBuildSeconds = parseInt(e.target.value, 10);
    $('cycleBuildVal').textContent = cycleBuildSeconds + 's';
    saveMandalaState();
  });

  $('bgColorPicker').addEventListener('input', (e) => {
    bgColourHex = e.target.value;
    bgColour = hexToHSB(bgColourHex);
    applyThemeFromBg(bgColourHex);
    if (trailMode === 'permanent'){ clearArt(); }
    saveMandalaState();
  });

  // Depth is meaningless on the p5 renderer, so the section only exists
  // (visually) when this renderer is the one driving the page
  $('depthSection').style.display = 'block';
  $('depthAmount').addEventListener('input', (e) => {
    depthAmount = parseInt(e.target.value, 10);
    $('depthVal').textContent = depthAmount;
    saveMandalaState();
  });
  $('depthDrift').addEventListener('change', (e) => { depthDrift = e.target.checked; saveMandalaState(); });
  $('resetCameraBtn').addEventListener('click', () => { userPitch = 0; userYaw = 0; });

  $('clearBtn').addEventListener('click', () => { clearArt(); });
  $('saveBtn').addEventListener('click', () => { saveImage(); });
  $('randomBtn').addEventListener('click', () => randomizeSettings($));

  $('presetNeon').addEventListener('click', () => applyPreset('neon'));
  $('presetGold').addEventListener('click', () => applyPreset('gold'));
  $('presetOcean').addEventListener('click', () => applyPreset('ocean'));
  $('presetChaos').addEventListener('click', () => applyPreset('chaosBloom'));
  $('presetStardust').addEventListener('click', () => applyPreset('stardust'));
  $('presetRave').addEventListener('click', () => applyPreset('laserRave'));
  $('presetInk').addEventListener('click', () => applyPreset('zenInk'));
  $('presetAurora').addEventListener('click', () => applyPreset('aurora'));
  $('presetFirefly').addEventListener('click', () => applyPreset('fireflies'));
  $('presetCandy').addEventListener('click', () => applyPreset('bubblegum'));
}

function randomizeSettings($){
  symmetry = floor(random(4, 41));
  $('symmetry').value = symmetry;
  $('symmetryVal').textContent = symmetry;

  mirror = random() > 0.35;
  $('mirror').checked = mirror;

  symmetryMode = random(['radial', 'radial', 'kaleido', 'spiral', 'grid']);
  $('symmetryMode').value = symmetryMode;

  strokeStyleMode = random(['line', 'ribbon', 'dots', 'sparkle', 'rails', 'rings', 'petals', 'taper', 'chalk', 'dashed', 'silk']);
  $('strokeStyle').value = strokeStyleMode;

  pulseBrush = random() > 0.5;
  $('pulseBrush').checked = pulseBrush;

  colourMode = random(['rainbow', 'gradient', 'solid']);
  $('colourMode').value = colourMode;
  $('solidColorGroup').style.display = colourMode === 'solid' ? 'block' : 'none';
  $('paletteGroup').style.display = colourMode === 'solid' ? 'none' : 'block';
  $('rainbowSpeedGroup').style.display = colourMode === 'rainbow' ? 'block' : 'none';

  palette = random(['full', 'sunset', 'ocean', 'forest', 'mono']);
  $('palette').value = palette;

  glowIntensity = floor(random(4, 24));
  $('glow').value = glowIntensity;
  $('glowVal').textContent = glowIntensity;

  strokeAlpha = floor(random(60, 101));
  $('strokeAlpha').value = strokeAlpha;
  $('strokeAlphaVal').textContent = strokeAlpha;

  rainbowSpeed = Math.round(random(0.3, 1.6) * 10) / 10;
  $('rainbowSpeed').value = rainbowSpeed;
  $('rainbowSpeedVal').textContent = rainbowSpeed.toFixed(1);

  saveMandalaState();
}

// ---------- bootstrap ----------
// All GL setup happens before any listeners are attached, so if anything
// throws (no context, shader failure, framebuffer unsupported) we can tear
// the canvas back down and return false — render-loader.js then loads the
// p5 fallback against a clean DOM.
function start(){
  try {
    bgColour = hexToHSB(bgColourHex);
    bufferSize = computeBufferSize();

    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '1';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none'; // stop touch scroll/zoom fighting the drawing
    document.body.appendChild(canvas);

    initGL();

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      initGL();
      contextLost = false;
    });
  } catch (err){
    console.warn('WebGL mandala init failed:', err);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; gl = null;
    return false;
  }

  applyThemeFromBg(bgColourHex);
  wireInputTracking();
  wireUpPanel();
  window.addEventListener('resize', onResize);

  // same public surface as sketch.js, so main.js / breathing.js don't care
  // which renderer is active
  window.applyMandalaState = applyMandalaState;
  window.getMandalaState = currentMandalaState; // user presets / Today's mandala
  window.setBreathingRotate = setBreathingRotate;

  // camera-control tips in the how-to only apply to this renderer
  document.querySelectorAll('#howtoBox .howto-webgl').forEach((li) => {
    li.style.display = 'list-item';
  });

  const flavour = (isWebGL2 ? 'WebGL2' : 'WebGL1') + (floatTrails ? ' (float trails)' : ' (8-bit trails)');
  document.documentElement.dataset.renderer = 'webgl';
  console.info('Mandala renderer: ' + flavour);

  rafId = requestAnimationFrame(frame);
  return true;
}

window.MandalaWebGL = { start };
})();
