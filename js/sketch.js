// ---------- mandala p5 sketch (global mode) + settings panel wiring ----------
let symmetry = 12;
let mirror = true;
let brushSize = 10;
let reactToSpeed = false;
let clickToDraw = false;
let colourMode = 'rainbow';
let solidColourHex = '#ff3e94';
let trailMode = 'fade';
let fadeSpeed = 4;
let bgColourHex = '#0a0a0a';
let bgColourP5;

// ---------- 'cycle' trail mode ----------
// alternates between a 'building' phase (behaves exactly like permanent —
// zero fade, so detail accumulates crisply) and a 'fading' phase (behaves
// exactly like fade mode, clearing the backlog while still drawing new
// strokes), then returns to building. Reuses the existing fade-mode
// rendering/correction logic for the fading phase — only the phase-timer
// bookkeeping below is new.
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
    // how long the fading phase runs scales inversely with fadeSpeed — a
    // slow fade rate needs more time to actually clear the backlog than a
    // fast one, same reasoning as the fade-mode correction cycle below
    const fadePhaseMs = constrain(round(60000 / fadeSpeed), 3000, 30000);
    if (elapsed > fadePhaseMs){
      cyclePhase = 'building';
      cyclePhaseStartMs = Date.now();
    }
  }
}

// theme color drives the canvas background AND the panel's glass tint —
// one picker, everything follows it — while gold/magenta/cyan accents stay
// fixed, since black-and-gold is the whole point
function applyThemeFromBg(hex){
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.setProperty('--panel-bg', `rgba(${r}, ${g}, ${b}, 0.68)`);
  // a touch lighter than the raw theme colour so inputs/selects are
  // distinguishable against the glass panel instead of blending invisibly in
  const lr = Math.round(r + (255 - r) * 0.12);
  const lg = Math.round(g + (255 - g) * 0.12);
  const lb = Math.round(b + (255 - b) * 0.12);
  document.documentElement.style.setProperty('--select-bg', `rgb(${lr}, ${lg}, ${lb})`);
}

// ---------- rotation buffer ----------
// The mandala is drawn onto this offscreen buffer, which is NEVER itself
// rotated or resampled — it's oversized (canvas diagonal) so it always fully
// covers the visible viewport. Each frame we blit it to the real canvas
// rotated by `rotationAngle`. Rotating only at display time (instead of
// capturing+rotating+re-pasting the canvas every frame) avoids the repeated
// bilinear resampling that was smearing/"burning" the trails and leaving
// background-coloured gaps at the corners of the non-square canvas.
let artLayer;
let bufferSize;
let rotationAngle = 0;

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
let strokeAlpha = 92;        // stroke opacity, 0-100 like the HSB alpha scale
let rainbowSpeed = 0.7;      // hue-cycle rate in rainbow colour mode
let idlePace = 100;          // % multiplier on ambient drawing speed
let idleShuffleSeconds = 10; // how often ambient drawing restyles itself

// ---------- silk wisps (after weavesilk.com) ----------
// The pointer lays points into a rope; every frame the rope is nudged by a
// Perlin-noise force field and the WHOLE rope is redrawn several times at
// very low alpha with additive blending. The smoke sheets are hundreds of
// ghost copies of the rope accumulating as the noise wiggles it — density,
// not blur, makes the glow.
const SILK_STEPS_PER_FRAME = 3; // physics+draw passes per frame (ghost density)
const SILK_POINT_LIFE = 100;    // steps a rope point lives after being laid
const SILK_MAX_ROPE_POINTS = 120; // hard cap so a rope can't grow unbounded
const SILK_MAX_ROPES = 6;         // mouse + idle pens + a couple of leftovers
const SILK_FRICTION = 0.975;      // carries constraint corrections, like silk cloth
const SILK_RIGIDITY = 0.2;        // neighbour pull-together per step
const SILK_NOISE_SPACE = 0.02;    // noise field scale per buffer px
const SILK_NOISE_TIME = 0.005;    // how fast the field itself evolves
const SILK_NOISE_ANGLE = 5 * Math.PI; // noise value -> force angle sweep
const SILK_IVEL_FORCE = 0.3;      // launch push from the cursor's velocity
const SILK_IVEL_DECAY = 0.98;
let silkRopes = [];  // { pts: [{x,y,px,py,ivx,ivy,life}], lastInX, lastInY }
let silkTime = 0;    // physics step counter driving the noise field's z axis

// ---------- idle ambient drawing ----------
// If the real cursor hasn't moved in a while, the mandala keeps itself
// company by drawing from a slow generative wander instead — the instant a
// real mousemove fires, control snaps straight back to the cursor.
const IDLE_THRESHOLD_MS = 1000;
// each is a genuinely different motion shape, not just a parameter tweak on
// the same formula — switching between them (alongside the cosmetic
// shuffle) keeps the ambient art from settling into one repeating cadence
const IDLE_PATH_ALGORITHMS = ['rose', 'spiral', 'lissajous', 'drift', 'epicycle', 'lemniscate', 'wave'];
// a freshly opened tab starts drawing on frame one instead of sitting empty
// for the idle threshold — the wait only applies after real input has
// happened at least once
let hasInteracted = false;
// with doubleIdlePattern on, two independent "pens" run at once, each with
// its own position/motion state and (usually) its own algorithm, both
// drawing into the same symmetric pattern each frame — more going on at
// once, but roughly doubles idle-draw cost, hence it being an opt-in toggle
let lastRealInput = Date.now();
let idleActive = false;
let idlePens = [];
let idleSpeedT = 0;
let idlePrevConfig = null;
let idleConfigTimer = null;

// every shape/color/brush/motion option (everything except canvas-level
// stuff like trail mode and background) gets shuffled every
// IDLE_CONFIG_INTERVAL_MS while idle, then handed back exactly as it was
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
  cfg.mirror = true; // always on — unmirrored ambient art reads as scribble
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
    cfg.solidColourHex = color(random(360), 75, 100).toString('#rrggbb');
    cfg.rainbowSpeed = random(0.3, 1.5);
  }
  // kept above 55 so ambient art never looks washed out on the shuffle
  if (R.strokeAlpha) cfg.strokeAlpha = floor(random(55, 101));
  if (R.glow) cfg.glowIntensity = span(ambient.glowMin, ambient.glowMax);
  if (R.brush) cfg.brushSize = span(ambient.brushMin, ambient.brushMax);
  if (R.reactToSpeed) cfg.reactToSpeed = random() > 0.3;
  if (R.sparkleDust) cfg.sparkleDust = random() > 0.6;
  if (R.rotation){
    // spinning isn't just faster/slower — it can stop entirely for a
    // stretch too, so a shuffle window might spin fast, sit still, spin again
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
  // different algorithms compute wildly different positions, so a fresh
  // pen (null position) avoids drawing one straight streak connecting the
  // old shape to the new one. Only pick from patterns the Ambient tab has
  // enabled (fall back to all if every single one has been unticked).
  const pool = (ambient.patterns && ambient.patterns.length) ? ambient.patterns : IDLE_PATH_ALGORITHMS;
  const penCount = doubleIdlePattern ? 2 : 1;
  const chosen = [];
  idlePens = [];
  for (let i = 0; i < penCount; i++){
    let algorithm;
    do {
      algorithm = random(pool);
      // prefer distinct algorithms across pens for more visual variety —
      // but don't loop forever if the pool is smaller than the pen count
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
    // draw()), not on this fixed clock
    if (ambient.gallery) return;
    applyCosmeticConfig(randomCosmeticConfig());
    pickIdlePathAlgorithms();
  }, idleShuffleSeconds * 1000);
}

function exitIdleConfigShuffle(){
  if (idleConfigTimer){ clearInterval(idleConfigTimer); idleConfigTimer = null; }
  if (idlePrevConfig){ applyCosmeticConfig(idlePrevConfig); idlePrevConfig = null; }
}

window.addEventListener('mousemove', () => {
  // moving around the menu isn't drawing intent — ambient mode keeps
  // painting behind the panel. Actually touching a control still wakes
  // it (the capture-phase listeners in wireUpPanel), so changes made
  // there are never clobbered by the shuffle's restore-on-wake.
  if (mouseOverUI) return;
  lastRealInput = Date.now();
  hasInteracted = true;
  if (idleActive){
    idleActive = false;
    lastX = null; lastY = null; // force a fresh starting point below, not a stale pre-idle one
    exitIdleConfigShuffle();
  }
  // establish a clean starting point from this real event's actual position
  // — otherwise the very first movement (or the first one after idle/resize)
  // draws a spurious stroke from stale (0,0) or a stale pre-idle position
  if (lastX === null){
    lastX = mouseX; lastY = mouseY;
  }
});
window.addEventListener('touchstart', () => { lastRealInput = Date.now(); hasInteracted = true; }, { passive: true });

// panel, HUD widgets, and the wizard/breathing overlays all share the .ui
// class — pause drawing while the cursor is over any of them, so e.g.
// switching to permanent trail mode and then moving the mouse back up to
// the panel toggle doesn't paint a stroke across the menu on the way there.
// mouseenter/mouseleave (unlike mouseover/mouseout) don't bubble, so this
// only fires for the specific .ui container being entered/left, not for
// every child element inside it.
let mouseOverUI = false;
document.querySelectorAll('.ui').forEach((el) => {
  el.addEventListener('mouseenter', () => { mouseOverUI = true; });
  el.addEventListener('mouseleave', () => { mouseOverUI = false; });
});

// click-to-draw: is the primary button (or a touch/pen contact) held on the
// canvas right now? A press that starts on the UI never counts, and anything
// that can swallow the release (leaving the window, alt-tab) clears it.
let pointerHeld = false;
window.addEventListener('pointerdown', (e) => { if (e.button === 0 && !mouseOverUI) pointerHeld = true; });
window.addEventListener('pointerup', () => { pointerHeld = false; });
window.addEventListener('pointercancel', () => { pointerHeld = false; });
window.addEventListener('blur', () => { pointerHeld = false; });

let hueShift = 0;
let lastX = null, lastY = null;
let particles = [];

// screen-space endpoints of last frame's strokes (with each stroke's
// carried stamp distance) — lets stamped styles space their shapes evenly
// along a continuing path
let prevStrokeEnds = [];
let curStrokeEnds = [];

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

function computeBufferSize(){
  return Math.ceil(Math.sqrt(windowWidth * windowWidth + windowHeight * windowHeight)) + 4;
}

function setup(){
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.style('position', 'fixed');
  cnv.style('top', '0');
  cnv.style('left', '0');
  cnv.style('z-index', '1');
  pixelDensity(1);
  colorMode(HSB, 360, 100, 100, 100);
  bgColourP5 = hexToHSB(bgColourHex);
  applyThemeFromBg(bgColourHex);
  background(bgColourP5);

  bufferSize = computeBufferSize();
  artLayer = createGraphics(bufferSize, bufferSize);
  artLayer.pixelDensity(1);
  artLayer.colorMode(HSB, 360, 100, 100, 100);
  artLayer.background(bgColourP5);

  wireUpPanel();
}

// maps a screen-space point (relative to the visible canvas) to the
// artLayer's own un-rotated coordinate space, cancelling out the current
// display rotation so a freshly drawn stroke still lands under the cursor
function toBufferSpace(x, y){
  const cx = width / 2, cy = height / 2;
  const dx = x - cx, dy = y - cy;
  const a = radians(-rotationAngle);
  const cosA = cos(a), sinA = sin(a);
  return {
    x: bufferSize / 2 + dx * cosA - dy * sinA,
    y: bufferSize / 2 + dx * sinA + dy * cosA
  };
}

function draw(){
  if (autoRotate){
    rotationAngle = (rotationAngle + rotateSpeed) % 360;
  }

  if (trailMode === 'cycle'){
    updateCyclePhase();
  }

  if (trailMode === 'fade' || (trailMode === 'cycle' && cyclePhase === 'fading')){
    artLayer.drawingContext.shadowBlur = 0;
    artLayer.noStroke();
    // canvas pixels are 8-bit, so a low, gentle fade alpha (the normal case —
    // low fadeSpeed values are what give long, slowly-fading trails) always
    // stops fully converging once a pixel is within a few shades of the
    // background: the rounded delta hits zero and that pixel is stuck there
    // permanently. It's invisible per-pixel, but since drawing (mouse or
    // idle) sweeps across the whole canvas over time, those stuck-just-off
    // pixels accumulate into a visible faint tint everywhere anything was
    // ever drawn.
    //
    // A periodic correction fully clears the residue, but flipping the
    // alpha between two fixed values on a single frame reads as a visible
    // hard "step" in brightness. Instead, ramp smoothly up to the corrective
    // alpha and back down over several frames — a gentle breath rather than
    // a jump cut. It still needs to reach >50% alpha at its peak though:
    // rounding only ever fails to fully close a 1-unit gap when the fade
    // removes *less than half* of it in one step, so anything under 50%
    // leaves that last unit stuck no matter how often it runs.
    //
    // The cycle length scales with fadeSpeed itself — a low fadeSpeed means
    // strokes are meant to take many seconds to fade, so a fixed short cycle
    // would itself become the dominant fade rate and force everything to
    // disappear far faster than the slider says. Scaling it inversely with
    // fadeSpeed keeps the correction's job limited to "polish off what's
    // already nearly-faded", not "override the requested fade time".
    const correctionCycle = max(20, round(300 / fadeSpeed));
    const correctionPhase = (frameCount % correctionCycle) / correctionCycle;
    let correctionBoost = pow(max(0, sin(PI * correctionPhase)), 8);
    // the breath can't tell residue from fresh ink — while the user is
    // actively drawing it would eat their strokes as fast as they're laid
    // (paint… vanish… paint again, on the cycle above). Hold it off until
    // the hand has rested a moment; the residue it exists to clean builds
    // over minutes, so correcting between strokes is plenty.
    if (Date.now() - lastRealInput < 2000) correctionBoost = 0;
    const fadeAlpha = fadeSpeed + correctionBoost * (60 - fadeSpeed);
    artLayer.fill(hue(bgColourP5), saturation(bgColourP5), brightness(bgColourP5), fadeAlpha);
    artLayer.rect(0, 0, bufferSize, bufferSize);
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
      artLayer.drawingContext.shadowBlur = 0;
      artLayer.noStroke();
      artLayer.fill(hue(bgColourP5), saturation(bgColourP5), brightness(bgColourP5), 14);
      artLayer.rect(0, 0, bufferSize, bufferSize);
      if (heldMs > 2600){
        artLayer.background(bgColourP5); // hard clear: no 8-bit fade residue
        silkRopes = []; // live ropes would redraw ghosts onto the fresh piece
        galleryFading = false;
        galleryPhaseStart = Date.now();
        applyCosmeticConfig(randomCosmeticConfig());
        pickIdlePathAlgorithms();
      }
    }
  }

  if (idleActive){
    if (!galleryHold) stepIdleDrawing();
  } else if (lastX !== null){
    // lastX stays null until the mousemove listener above has established a
    // real starting point — nothing to draw yet, and nothing should guess one.
    // lastX/lastY still track the cursor while over UI (just below), so the
    // moment it re-enters the canvas there's no big stroke connecting the
    // pre-hover position to the current one — it just resumes cleanly.
    // lastX/lastY keep tracking even while click-to-draw withholds the pen,
    // so pressing the button starts the stroke at the cursor — no line
    // bridging from wherever the last stroke ended
    if (!mouseOverUI && (!clickToDraw || pointerHeld) && (mouseX !== lastX || mouseY !== lastY)){
      drawMandalaStroke(lastX, lastY, mouseX, mouseY);
    }
    lastX = mouseX; lastY = mouseY;
  }

  // after input so points laid this frame are already part of the rope
  silkFrame();

  background(bgColourP5);
  push();
  imageMode(CENTER);
  translate(width / 2, height / 2);
  rotate(radians(rotationAngle));
  image(artLayer, 0, 0, bufferSize, bufferSize);
  pop();
}

// computes one pen's raw next position for its current algorithm. rose and
// spiral trace their shape as a function of an ever-increasing ANGLE (that's
// what makes them draw a flower/spiral at all) — controlling their speed
// has to mean angular velocity, never a uniform pixel-distance step. A
// uniform pixel step sounds like a tidy way to equalize all four
// algorithms' pace, but it actively breaks rose/spiral: the same pixel step
// is a huge angle change near the center (spins in tight fast little
// circles) and a tiny one near the edge (barely creeps), which is exactly
// the "small circles barely moving" bug. Each algorithm below is instead
// individually tuned so their natural paces roughly match.
function computeIdleStep(pen, speedEnvelope, cx, cy, maxRX, maxRY){
  let nx, ny;

  if (pen.algorithm === 'rose'){
    // classic rose curve (r = cos(k*theta)) — traces actual petal shapes
    pen.dirAngle += 0.014 * speedEnvelope;
    pen.pulseT += 0.0018 * speedEnvelope;
    const petals = 2 + noise(pen.pulseT) * 4;
    const roseFactor = abs(cos(petals * pen.dirAngle));
    // abs(cos()), sampled at a roughly constant angular rate, produces an
    // "arcsine" distribution of values — it spends far more time near 0 and
    // 1 than near 0.5, because its rate of change vanishes right at those
    // extremes. Left alone, that means the radius keeps landing on the same
    // two rings (innermost and outermost) pass after pass, which reads as
    // suspiciously repeatable concentric bands rather than organic
    // coverage. Independent noise on top breaks that correlation.
    const radiusJitter = (noise(pen.pulseT * 5, 900) - 0.5) * 0.3;
    const distFactor = constrain(0.1 + roseFactor * 0.9 + radiusJitter, 0.05, 1);
    nx = cx + cos(pen.dirAngle) * maxRX * distFactor;
    ny = cy + sin(pen.dirAngle) * maxRY * distFactor;

  } else if (pen.algorithm === 'spiral'){
    // steady sweep with the radius drifting via smooth noise instead of a
    // hard cosine bounce, so it doesn't have that repeating "cusp" feel.
    // Already noise-driven (not cos-driven), so it doesn't have rose's
    // arcsine clustering, but a second independent noise layer still helps
    // avoid the radius ever tracking too predictably.
    pen.dirAngle += 0.012 * speedEnvelope;
    pen.pulseT += 0.0025 * speedEnvelope;
    const radiusJitter = (noise(pen.pulseT * 5, 3000) - 0.5) * 0.15;
    const distFactor = constrain(0.05 + noise(pen.pulseT) * 0.95 + radiusJitter, 0.02, 1);
    nx = cx + cos(pen.dirAngle) * maxRX * distFactor;
    ny = cy + sin(pen.dirAngle) * maxRY * distFactor;

  } else if (pen.algorithm === 'lissajous'){
    // two independent sine waves on x/y at different, drifting frequencies
    // — classic spirograph-style loops that rarely retrace themselves.
    // Kept to a narrower/lower frequency range than earlier attempts so its
    // peak speed (~freq × pulseT-rate × reach) lands in the same ballpark
    // as rose/spiral's tangential speed instead of miles faster. sin() has
    // the same arcsine-clustering issue as rose's cos() (see above), so it
    // gets the same independent-noise jitter treatment.
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
    // 'drift': a continuously wandering direction (not an easing-toward-a-
    // point chase, which stalls once it catches up to its target) blended
    // with a gentle pull back toward center so it wanders the whole canvas
    // without drifting off past an edge and getting stuck out there. This
    // one genuinely isn't angle-parameterized like the others, so a direct
    // fixed pixel step is the right (and simplest) speed control for it.
    pen.pulseT += 0.006 * speedEnvelope;
    const px = pen.x === null ? cx : pen.x;
    const py = pen.y === null ? cy : pen.y;
    const wanderAngle = noise(pen.pulseT, 500) * TWO_PI * 3;
    const toCenterX = cx - px, toCenterY = cy - py;
    const distFromCenter = Math.hypot(toCenterX, toCenterY) || 1;
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
  // a slow envelope makes the pace breathe gently between calm and a little
  // quicker, purely from continuous noise — no sudden jumps, so it reads as
  // peaceful rather than sporadic. Kept modest (max ~0.85) — this is the
  // single biggest lever on how "fast/sporadic" the whole thing feels.
  idleSpeedT += 0.003;
  const speedEnvelope = (0.35 + noise(idleSpeedT) * 0.5) * (idlePace / 100);

  const cx = width / 2, cy = height / 2;
  // separate X/Y reach (not a single shared radius) so the pattern stretches
  // to fill the actual rectangular viewport instead of being confined to a
  // circle inscribed in the shorter dimension
  const maxRX = (width / 2) * 0.97;
  const maxRY = (height / 2) * 0.97;

  // two independent pens draw at once — each has its own position/motion
  // state and (usually) its own algorithm, both feeding the same symmetric
  // pattern each frame, so there's more happening on screen at once
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
    return color(hue(c), saturation(c), brightness(c), strokeAlpha);
  }
  return color(paletteHue(t), 75, 100, strokeAlpha);
}

function drawStar(x, y, radius1, radius2, npoints){
  const angle = TWO_PI / npoints;
  const halfAngle = angle / 2.0;
  artLayer.beginShape();
  for (let a = 0; a < TWO_PI; a += angle){
    let sx = x + cos(a) * radius2;
    let sy = y + sin(a) * radius2;
    artLayer.vertex(sx, sy);
    sx = x + cos(a + halfAngle) * radius1;
    sy = y + sin(a + halfAngle) * radius1;
    artLayer.vertex(sx, sy);
  }
  artLayer.endShape(CLOSE);
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
  // point through the new rotation lands where the ink isn't anymore, which
  // tore visible gaps into strokes whenever the canvas was spinning
  const p1 = continuing ? { x: prev[3], y: prev[4] } : toBufferSpace(x1, y1);
  const p2 = toBufferSpace(x2, y2);
  const cx = bufferSize / 2, cy = bufferSize / 2;
  const dx = p2.x - cx, dy = p2.y - cy;
  const pdx = p1.x - cx, pdy = p1.y - cy;
  const speed = dist(x1, y1, x2, y2);

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

  let strokeColour;
  if (colourMode === 'rainbow'){
    const t = ((hueShift + (reactToSpeed ? speed * 4 : 0)) % 360) / 360;
    strokeColour = strokeColourFromT(t);
    hueShift = (hueShift + rainbowSpeed) % 360;
  } else if (colourMode === 'gradient'){
    const d = dist(dx, dy, 0, 0);
    const maxD = dist(0, 0, cx, cy);
    const t = constrain(d / maxD, 0, 1);
    strokeColour = strokeColourFromT(t);
  } else {
    const solid = hexToHSB(solidColourHex);
    strokeColour = color(hue(solid), saturation(solid), brightness(solid), strokeAlpha);
  }

  artLayer.drawingContext.shadowBlur = glowIntensity;
  artLayer.drawingContext.shadowColor = strokeColour.toString();

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
      const r = Math.hypot(x, y);
      let a = ((Math.atan2(y, x) % (2 * wedge)) + 2 * wedge) % (2 * wedge);
      if (a > wedge) a = 2 * wedge - a;
      return { x: r * cos(a), y: r * sin(a) };
    };
    const f1 = fold(P1x, P1y), f2 = fold(P2x, P2y);
    P1x = f1.x; P1y = f1.y; P2x = f2.x; P2y = f2.y;
  }

  artLayer.push();
  artLayer.translate(cx, cy);

  if (symmetryMode === 'grid'){
    // tiled wallpaper: the whole drawing shrinks into each cell, flipped
    // checkerboard-fashion so adjacent tiles reflect into each other
    const cells = constrain(round(Math.sqrt(symmetry)), 2, 6);
    const tile = bufferSize / cells;
    const s = 1 / cells;
    for (let gy = 0; gy < cells; gy++){
      for (let gx = 0; gx < cells; gx++){
        artLayer.push();
        artLayer.translate((gx + 0.5) * tile - cx, (gy + 0.5) * tile - cy);
        artLayer.scale(s * ((gx + gy) % 2 === 1 ? -1 : 1), s);
        drawArm(P1x, P1y, P2x, P2y, sw, strokeColour);
        if (mirror){
          artLayer.push();
          artLayer.scale(1, -1);
          drawArm(P1x, P1y, P2x, P2y, sw, strokeColour);
          artLayer.pop();
        }
        artLayer.pop();
      }
    }
  } else {
    const angleStep = TWO_PI / symmetry;
    // kaleidoscope needs the reflected copy regardless of the mirror
    // checkbox — alternating reflection is what closes the wedge pattern
    const bothSides = mirror || symmetryMode === 'kaleido';
    for (let i = 0; i < symmetry; i++){
      artLayer.rotate(angleStep);
      // spiral shells: each copy also shrinks, reaching ~35% after a full turn
      const sc = symmetryMode === 'spiral' ? Math.pow(0.35, i / symmetry) : 1;
      artLayer.push();
      if (sc !== 1) artLayer.scale(sc);
      drawArm(P1x, P1y, P2x, P2y, sw, strokeColour);
      artLayer.pop();
      if (bothSides){
        artLayer.push();
        artLayer.scale(sc, -sc);
        drawArm(P1x, P1y, P2x, P2y, sw, strokeColour);
        artLayer.pop();
      }
    }
  }
  artLayer.pop();

  artLayer.drawingContext.shadowBlur = 0;
}

function drawArm(pdx, pdy, dx, dy, sw, strokeColour){
  // spawn in THIS arm's own transformed space (translate+rotate+maybe
  // mirror are already active here), so sparkle dust appears on every
  // symmetry arm instead of only wherever the raw cursor/idle point is
  maybeSpawnParticles(dx, dy, strokeColour);

  if (strokeStyleMode === 'line' || strokeStyleMode === 'taper' || strokeStyleMode === 'dashed'){
    // taper varies sw upstream; dashed gates whole frames upstream — all
    // three lay down the same plain round-capped segment here
    artLayer.noFill();
    artLayer.stroke(strokeColour);
    artLayer.strokeWeight(sw);
    artLayer.strokeCap(ROUND);
    artLayer.line(pdx, pdy, dx, dy);

  } else if (strokeStyleMode === 'chalk'){
    // a firm core plus two loose jittered passes — rough ink/charcoal
    const j = max(sw * 0.6, 2);
    const h = hue(strokeColour), s = saturation(strokeColour), b = brightness(strokeColour);
    const a = alpha(strokeColour);
    artLayer.noFill();
    artLayer.strokeCap(ROUND);
    artLayer.stroke(h, s, b, a * 0.6);
    artLayer.strokeWeight(max(sw * 0.7, 1));
    artLayer.line(pdx, pdy, dx, dy);
    artLayer.stroke(h, s, b, a * 0.35);
    artLayer.strokeWeight(max(sw * 0.3, 0.8));
    artLayer.line(pdx + random(-j, j), pdy + random(-j, j), dx + random(-j, j), dy + random(-j, j));
    artLayer.line(pdx + random(-j, j), pdy + random(-j, j), dx + random(-j, j), dy + random(-j, j));

  } else if (strokeStyleMode === 'ribbon'){
    artLayer.noFill();
    artLayer.strokeCap(ROUND);
    artLayer.stroke(hue(strokeColour), saturation(strokeColour), brightness(strokeColour), 28);
    artLayer.strokeWeight(sw * 2.2);
    artLayer.line(pdx, pdy, dx, dy);
    artLayer.stroke(strokeColour);
    artLayer.strokeWeight(max(sw * 0.4, 1));
    artLayer.line(pdx, pdy, dx, dy);

  } else if (strokeStyleMode === 'dots'){
    artLayer.noStroke();
    artLayer.fill(strokeColour);
    artLayer.ellipse(dx, dy, sw, sw);

  } else if (strokeStyleMode === 'sparkle'){
    // minimum size so the 4-point shape stays legible at small brushes
    const s = max(sw, 5);
    artLayer.noStroke();
    artLayer.fill(strokeColour);
    drawStar(dx, dy, s * 0.5, s * 1.6, 4);

  } else if (strokeStyleMode === 'rails'){
    // two thin parallel lines riding either side of the stroke path, with a
    // minimum gap so they read as two even at small brush sizes
    let ddx = dx - pdx, ddy = dy - pdy;
    const dl = Math.hypot(ddx, ddy);
    if (dl < 1e-6){ ddx = 1; ddy = 0; } else { ddx /= dl; ddy /= dl; }
    const off = max(sw * 0.9, 6);
    const ox = -ddy * off, oy = ddx * off;
    artLayer.noFill();
    artLayer.stroke(strokeColour);
    artLayer.strokeWeight(max(sw * 0.35, 1));
    artLayer.strokeCap(ROUND);
    artLayer.line(pdx + ox, pdy + oy, dx + ox, dy + oy);
    artLayer.line(pdx - ox, pdy - oy, dx - ox, dy - oy);

  } else if (strokeStyleMode === 'rings'){
    const rr = max(sw * 1.4, 8);
    artLayer.noFill();
    artLayer.stroke(strokeColour);
    artLayer.strokeWeight(max(1.5, rr * 0.16));
    artLayer.circle(dx, dy, rr * 2);

  } else if (strokeStyleMode === 'petals'){
    // an elongated stamp oriented along the motion direction
    const ph = max(sw * 1.3, 8);
    const pw = max(sw * 0.45, 1.5);
    artLayer.noStroke();
    artLayer.fill(strokeColour);
    artLayer.push();
    artLayer.translate(dx, dy);
    artLayer.rotate(Math.atan2(dy - pdy, dx - pdx));
    artLayer.ellipse(0, 0, ph * 2 + pw, pw * 2);
    artLayer.pop();
  }
}

// ---------- silk wisps engine ----------
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
    const nv = noise(p.x * SILK_NOISE_SPACE, p.y * SILK_NOISE_SPACE, silkTime * SILK_NOISE_TIME);
    const na = SILK_NOISE_ANGLE * nv + symAngle;
    let accx = Math.cos(na) + SILK_IVEL_FORCE * p.ivx;
    let accy = Math.sin(na) + SILK_IVEL_FORCE * p.ivy;
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

// stroke colour for a rope through the normal colour engine (alpha handled
// separately via globalAlpha so the additive passes stay dim)
function silkRopeColour(rope){
  if (colourMode === 'rainbow'){
    const t = (hueShift % 360) / 360;
    if (palette === 'custom'){
      const c = hexToHSB(customPaletteHex(t));
      return color(hue(c), saturation(c), brightness(c), 100);
    }
    return color(paletteHue(t), 75, 100, 100);
  }
  if (colourMode === 'gradient'){
    const cx = bufferSize / 2, cy = bufferSize / 2;
    const newest = rope.pts[rope.pts.length - 1];
    const t = constrain(dist(newest.x, newest.y, cx, cy) / dist(0, 0, cx, cy), 0, 1);
    if (palette === 'custom'){
      const c = hexToHSB(customPaletteHex(t));
      return color(hue(c), saturation(c), brightness(c), 100);
    }
    return color(paletteHue(t), 75, 100, 100);
  }
  const solid = hexToHSB(solidColourHex);
  return color(hue(solid), saturation(solid), brightness(solid), 100);
}

// the whole living rope as one smooth midpoint-quadratic path, in
// centre-relative coords (the arm transforms are already active)
function silkPath(pts){
  const ctx = artLayer.drawingContext;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2){
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    let p1 = pts[1];
    for (let i = 1; i < pts.length - 1; i++){
      const p2 = pts[i + 1];
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      p1 = p2;
    }
  }
  ctx.stroke();
}

// draw every rope through the same symmetry replication drawMandalaStroke
// uses, but additively and at ghost alpha — one call per physics step
function silkDrawRopes(){
  const ctx = artLayer.drawingContext;
  const cx = bufferSize / 2, cy = bufferSize / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = max(brushSize * 0.15, 0.7);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 0; // additive stacking IS the glow — shadows just cost frames

  for (const rope of silkRopes){
    if (rope.pts.length < 2) continue;

    let pts = rope.pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    if (symmetryMode === 'kaleido'){
      const wedge = TWO_PI / max(symmetry, 1);
      pts = pts.map((p) => {
        const r = Math.hypot(p.x, p.y);
        let a = ((Math.atan2(p.y, p.x) % (2 * wedge)) + 2 * wedge) % (2 * wedge);
        if (a > wedge) a = 2 * wedge - a;
        return { x: r * cos(a), y: r * sin(a) };
      });
    }

    ctx.strokeStyle = silkRopeColour(rope).toString();
    // strokeAlpha 92 ≈ weavesilk's 0.09 per pass; the newest point's life
    // fraction fades the whole rope out once input stops feeding it
    ctx.globalAlpha = (strokeAlpha / 1000) * (rope.pts[rope.pts.length - 1].life / SILK_POINT_LIFE);

    artLayer.push();
    artLayer.translate(cx, cy);
    if (symmetryMode === 'grid'){
      const cells = constrain(round(Math.sqrt(symmetry)), 2, 6);
      const tile = bufferSize / cells;
      const s = 1 / cells;
      for (let gy = 0; gy < cells; gy++){
        for (let gx = 0; gx < cells; gx++){
          artLayer.push();
          artLayer.translate((gx + 0.5) * tile - cx, (gy + 0.5) * tile - cy);
          artLayer.scale(s * ((gx + gy) % 2 === 1 ? -1 : 1), s);
          silkPath(pts);
          if (mirror){
            artLayer.push();
            artLayer.scale(1, -1);
            silkPath(pts);
            artLayer.pop();
          }
          artLayer.pop();
        }
      }
    } else {
      const angleStep = TWO_PI / symmetry;
      const bothSides = mirror || symmetryMode === 'kaleido';
      for (let i = 0; i < symmetry; i++){
        artLayer.rotate(angleStep);
        const sc = symmetryMode === 'spiral' ? Math.pow(0.35, i / symmetry) : 1;
        artLayer.push();
        if (sc !== 1) artLayer.scale(sc);
        silkPath(pts);
        artLayer.pop();
        if (bothSides){
          artLayer.push();
          artLayer.scale(sc, -sc);
          silkPath(pts);
          artLayer.pop();
        }
      }
    }
    artLayer.pop();
  }
  ctx.restore();
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
    silkDrawRopes();
  }
}

function maybeSpawnParticles(localX, localY, colourForParticle){
  if (!sparkleDust) return;
  // (localX, localY) is in the current arm's transformed space; particles
  // are drawn later with no transform active, so convert to world space now
  const world = new DOMPoint(localX, localY).matrixTransform(artLayer.drawingContext.getTransform());
  const count = floor(random(1, 3));
  for (let i = 0; i < count; i++){
    particles.push({
      x: world.x + random(-6, 6),
      y: world.y + random(-6, 6),
      vx: random(-0.3, 0.3),
      vy: random(-0.7, -0.2),
      life: 255,
      col: colourForParticle
    });
  }
}

function updateAndDrawParticles(){
  if (particles.length === 0) return;
  artLayer.drawingContext.shadowBlur = 0;
  artLayer.noStroke();
  for (let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.life -= 6;
    if (p.life <= 0){ particles.splice(i, 1); continue; }
    artLayer.fill(hue(p.col), saturation(p.col), brightness(p.col), map(p.life, 0, 255, 0, 90));
    artLayer.circle(p.x, p.y, 3);
  }
}

function hexToHSB(hex){
  push();
  colorMode(RGB, 255);
  const c = color(hex);
  pop();
  colorMode(HSB, 360, 100, 100, 100);
  return color(hue(c), saturation(c), brightness(c));
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
  background(bgColourP5);
  bufferSize = computeBufferSize();
  artLayer.resizeCanvas(bufferSize, bufferSize);
  artLayer.background(bgColourP5);
  lastX = null; lastY = null;
}

// ---------- touch support (phones/tablets) ----------
// p5 syncs mouseX/mouseY to the active touch automatically, so the same
// draw() loop that handles the mouse also handles a dragging finger.
// These two just stop the browser's own scroll/zoom from fighting with it,
// and only on the canvas itself — panel and widgets stay normal.
function touchStarted(event){
  if (event && event.target && event.target.tagName === 'CANVAS'){
    return false;
  }
}

function touchMoved(event){
  if (event && event.target && event.target.tagName === 'CANVAS'){
    return false;
  }
}

// ---------- state load (from storage) ----------
function applyMandalaState(m){
  const $ = (id) => document.getElementById(id);
  symmetry = m.symmetry; $('symmetry').value = symmetry; $('symmetryVal').textContent = symmetry;
  mirror = m.mirror; $('mirror').checked = mirror;
  brushSize = m.brushSize; $('brush').value = brushSize; $('brushVal').textContent = brushSize;
  reactToSpeed = m.reactToSpeed; $('reactSpeed').checked = reactToSpeed;
  clickToDraw = !!m.clickToDraw; $('clickToDraw').checked = clickToDraw;
  colourMode = m.colourMode; $('colourMode').value = colourMode;
  solidColourHex = m.solidColourHex; $('solidColor').value = solidColourHex;
  symmetryMode = m.symmetryMode || 'radial'; $('symmetryMode').value = symmetryMode;
  customPalette = (m.customPalette && m.customPalette.length >= 2) ? m.customPalette.slice() : customPalette;
  trailMode = m.trailMode;
  document.querySelector('input[name="trail"][value="' + trailMode + '"]').checked = true;
  fadeSpeed = m.fadeSpeed; $('fadeSpeed').value = fadeSpeed; $('fadeVal').textContent = fadeSpeed;
  cycleBuildSeconds = m.cycleBuildSeconds; $('cycleBuildSeconds').value = cycleBuildSeconds; $('cycleBuildVal').textContent = cycleBuildSeconds + 's';
  bgColourHex = m.bgColourHex; $('bgColorPicker').value = bgColourHex;
  if (typeof color === 'function') bgColourP5 = hexToHSB(bgColourHex);
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
}

function currentMandalaState(){
  return {
    symmetry, mirror, symmetryMode, brushSize, reactToSpeed, clickToDraw, colourMode, solidColourHex,
    trailMode, fadeSpeed, cycleBuildSeconds, bgColourHex, palette, glowIntensity, pulseBrush,
    customPalette: customPalette.slice(),
    strokeStyleMode, autoRotate, rotateSpeed, sparkleDust, idleDraw,
    doubleIdlePattern, strokeAlpha, rainbowSpeed, idlePace, idleShuffleSeconds
  };
}

// user preset slots and "Today's mandala" (main.js) snapshot/apply through
// the same full-state path the storage load uses
window.getMandalaState = currentMandalaState;

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

// ---------- presets ----------
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
  if (p.clickToDraw !== undefined){ clickToDraw = p.clickToDraw; $('clickToDraw').checked = clickToDraw; }
  if (p.strokeAlpha !== undefined){ strokeAlpha = p.strokeAlpha; $('strokeAlpha').value = strokeAlpha; $('strokeAlphaVal').textContent = strokeAlpha; }
  if (p.rainbowSpeed !== undefined){ rainbowSpeed = p.rainbowSpeed; $('rainbowSpeed').value = rainbowSpeed; $('rainbowSpeedVal').textContent = rainbowSpeed.toFixed(1); }
  if (p.autoRotate !== undefined){ autoRotate = p.autoRotate; $('autoRotate').checked = autoRotate; $('rotateGroup').style.display = autoRotate ? 'block' : 'none'; }
  if (p.rotateSpeed !== undefined){
    rotateSpeed = p.rotateSpeed; userRotateSpeed = rotateSpeed;
    $('rotateSpeed').value = rotateSpeed; $('rotateVal').textContent = rotateSpeed.toFixed(2);
  }
  saveMandalaState();
}

// ---------- panel wiring ----------
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
  $('clickToDraw').addEventListener('change', (e) => { clickToDraw = e.target.checked; saveMandalaState(); });
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
    bgColourP5 = hexToHSB(bgColourHex);
    applyThemeFromBg(bgColourHex);
    if (trailMode === 'permanent'){ artLayer.background(bgColourP5); }
    saveMandalaState();
  });

  $('clearBtn').addEventListener('click', () => { artLayer.background(bgColourP5); silkRopes = []; });
  $('saveBtn').addEventListener('click', () => { saveCanvas('mandala', 'png'); });
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

  rainbowSpeed = round(random(0.3, 1.6) * 10) / 10;
  $('rainbowSpeed').value = rainbowSpeed;
  $('rainbowSpeedVal').textContent = rainbowSpeed.toFixed(1);

  saveMandalaState();
}
