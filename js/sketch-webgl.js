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
let brushSize = 3;
let reactToSpeed = true;
let colourMode = 'rainbow';
let solidColourHex = '#ff3e94';
let trailMode = 'fade';
let fadeSpeed = 8;
let bgColourHex = '#0a0a0a';
let bgColour; // {h,s,b} — HSB like the p5 version's bgColourP5

let palette = 'full';
let glowIntensity = 10;
let pulseBrush = false;
let strokeStyleMode = 'line'; // 'line' | 'ribbon' | 'dots' | 'sparkle'
let autoRotate = true;
let rotateSpeed = 0.15;
let chaos = 0;
let sparkleDust = false;
let idleDraw = true;
let doubleIdlePattern = false;

let rotationAngle = 0;
let bufferSize = 0;
let frameCount = 0;
let hueShift = 0;
let lastX = null, lastY = null;
let particles = [];

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
const IDLE_THRESHOLD_MS = 2000;
const IDLE_CONFIG_INTERVAL_MS = 10000;
const IDLE_PATH_ALGORITHMS = ['rose', 'spiral', 'lissajous', 'drift'];
let lastRealInput = Date.now();
let idleActive = false;
let idlePens = [];
let idleSpeedT = 0;
let idlePrevConfig = null;
let idleConfigTimer = null;

function randomCosmeticConfig(){
  return {
    symmetry: floor(random(6, 27)),
    mirror: true,
    strokeStyleMode: random(['line', 'ribbon', 'dots', 'sparkle']),
    pulseBrush: random() > 0.5,
    chaos: 0,
    colourMode: random(['rainbow', 'gradient', 'solid']),
    palette: random(['full', 'sunset', 'ocean', 'forest', 'mono']),
    solidColourHex: hsbToHex(random(360), 75, 100),
    glowIntensity: floor(random(4, 24)),
    brushSize: floor(random(1, 21)),
    reactToSpeed: random() > 0.3,
    sparkleDust: random() > 0.6,
    rotateSpeed: random(0, 0.25),
    autoRotate: random() > 0.35,
    trailMode: random(['fade', 'permanent', 'cycle']),
    cycleBuildSeconds: floor(random(5, 15))
  };
}

function captureCosmeticConfig(){
  return {
    symmetry, mirror, strokeStyleMode, pulseBrush, chaos, colourMode, palette,
    solidColourHex, glowIntensity, brushSize, reactToSpeed, sparkleDust, rotateSpeed,
    autoRotate, trailMode, cycleBuildSeconds
  };
}

function applyCosmeticConfig(cfg){
  ({
    symmetry, mirror, strokeStyleMode, pulseBrush, chaos, colourMode, palette,
    solidColourHex, glowIntensity, brushSize, reactToSpeed, sparkleDust, rotateSpeed,
    autoRotate, trailMode, cycleBuildSeconds
  } = cfg);
  if (trailMode === 'cycle') resetCyclePhase();
}

function pickIdlePathAlgorithms(){
  const penCount = doubleIdlePattern ? 2 : 1;
  const chosen = [];
  idlePens = [];
  for (let i = 0; i < penCount; i++){
    let algorithm;
    do {
      algorithm = random(IDLE_PATH_ALGORITHMS);
    } while (chosen.includes(algorithm) && chosen.length < IDLE_PATH_ALGORITHMS.length);
    chosen.push(algorithm);
    idlePens.push({ x: null, y: null, dirAngle: random(TWO_PI), pulseT: 0, algorithm });
  }
}

function enterIdleConfigShuffle(){
  idlePrevConfig = captureCosmeticConfig();
  applyCosmeticConfig(randomCosmeticConfig());
  pickIdlePathAlgorithms();
  idleConfigTimer = setInterval(() => {
    applyCosmeticConfig(randomCosmeticConfig());
    pickIdlePathAlgorithms();
  }, IDLE_CONFIG_INTERVAL_MS);
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
    mouseX = e.clientX; mouseY = e.clientY;
    lastRealInput = Date.now();
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
  window.addEventListener('touchstart', () => { lastRealInput = Date.now(); }, { passive: true });

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
// cancelling out the current display rotation (identical to sketch.js)
function toBufferSpace(x, y){
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const dx = x - cx, dy = y - cy;
  const a = radians(-rotationAngle);
  const cosA = cos(a), sinA = sin(a);
  return {
    x: bufferSize / 2 + dx * cosA - dy * sinA,
    y: bufferSize / 2 + dx * sinA + dy * cosA
  };
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

const CAPSULE_VS = `
attribute vec2 aPos;
attribute vec4 aSeg;
attribute vec2 aParam;
attribute vec4 aColor;
uniform vec2 uRes;
varying vec2 vPos;
varying vec4 vSeg;
varying vec2 vParam;
varying vec4 vColor;
void main(){
  vPos = aPos; vSeg = aSeg; vParam = aParam; vColor = aColor;
  gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

// distance-to-segment gives a capsule (round caps for free); the smoothstep
// edge is the antialiasing; the exp() term is the glow halo standing in for
// canvas shadowBlur
const CAPSULE_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
varying vec4 vSeg;
varying vec2 vParam;
varying vec4 vColor;
void main(){
  vec2 pa = vPos - vSeg.xy;
  vec2 ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  float hw = vParam.x;
  float glow = vParam.y;
  float a = 1.0 - smoothstep(hw - 0.75, hw + 0.75, d);
  if (glow > 0.01){
    float t = max(d - hw, 0.0) / glow;
    a = max(a, exp(-t * t * 3.0) * 0.5);
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

const TEX_VS = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform vec2 uRes;
varying vec2 vUV;
void main(){
  vUV = aUV;
  vec2 clip = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
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
  texProg = createProgram(TEX_VS, TEX_FS, ['aPos', 'aUV'], ['uRes', 'uTex']);

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
}

// geometry emitters — everything lands in this frame's batch arrays and is
// flushed into the art buffer once per frame (order within a batch is
// preserved by GL, so blending stacks the same way sequential p5 calls did)

function emitCapsule(ax, ay, bx, by, halfWidth, glowRadius, r, g, b, a){
  const pad = halfWidth + glowRadius + 1.5;
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
    capsuleVerts.push(c[k], c[k + 1], ax, ay, bx, by, halfWidth, glowRadius, r, g, b, a);
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
    gl.useProgram(capsuleProg.prog);
    gl.uniform2f(capsuleProg.uniforms.uRes, bufferSize, bufferSize);
    gl.bindBuffer(gl.ARRAY_BUFFER, capsuleVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(capsuleVerts), gl.DYNAMIC_DRAW);
    const stride = 12 * 4;
    gl.enableVertexAttribArray(capsuleProg.attribs.aPos);
    gl.vertexAttribPointer(capsuleProg.attribs.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(capsuleProg.attribs.aSeg);
    gl.vertexAttribPointer(capsuleProg.attribs.aSeg, 4, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(capsuleProg.attribs.aParam);
    gl.vertexAttribPointer(capsuleProg.attribs.aParam, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(capsuleProg.attribs.aColor);
    gl.vertexAttribPointer(capsuleProg.attribs.aColor, 4, gl.FLOAT, false, stride, 32);
    gl.drawArrays(gl.TRIANGLES, 0, capsuleVerts.length / 12);
    gl.disableVertexAttribArray(capsuleProg.attribs.aPos);
    gl.disableVertexAttribArray(capsuleProg.attribs.aSeg);
    gl.disableVertexAttribArray(capsuleProg.attribs.aParam);
    gl.disableVertexAttribArray(capsuleProg.attribs.aColor);
    capsuleVerts = [];
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

  const cx = w / 2, cy = h / 2;
  const half = bufferSize / 2;
  const aRad = radians(rotationAngle);
  const ca = cos(aRad), sa = sin(aRad);
  const corner = (lx, ly, u, v, out) => {
    out.push(cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, u, v);
  };
  const verts = [];
  corner(-half, -half, 0, 0, verts);
  corner(half, -half, 1, 0, verts);
  corner(-half, half, 0, 1, verts);
  corner(half, -half, 1, 0, verts);
  corner(half, half, 1, 1, verts);
  corner(-half, half, 0, 1, verts);

  gl.useProgram(texProg.prog);
  gl.uniform2f(texProg.uniforms.uRes, w, h);
  gl.uniform1i(texProg.uniforms.uTex, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, artTex);
  gl.bindBuffer(gl.ARRAY_BUFFER, texVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
  const stride = 4 * 4;
  gl.enableVertexAttribArray(texProg.attribs.aPos);
  gl.vertexAttribPointer(texProg.attribs.aPos, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texProg.attribs.aUV);
  gl.vertexAttribPointer(texProg.attribs.aUV, 2, gl.FLOAT, false, stride, 8);
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
      const correctionBoost = Math.pow(max(0, sin(PI * correctionPhase)), 8);
      fadeAlpha = fadeSpeed + correctionBoost * (60 - fadeSpeed);
    }
    fadePass(fadeAlpha);
  }

  updateAndDrawParticles();

  if (idleDraw && !idleActive && Date.now() - lastRealInput > IDLE_THRESHOLD_MS){
    idleActive = true;
    enterIdleConfigShuffle(); // also initializes fresh idlePens
  }

  if (idleActive){
    stepIdleDrawing();
  } else if (lastX !== null){
    if (!mouseOverUI && (mouseX !== lastX || mouseY !== lastY)){
      drawMandalaStroke(lastX, lastY, mouseX, mouseY);
    }
    lastX = mouseX; lastY = mouseY;
  }

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
  const speedEnvelope = 0.35 + noise(idleSpeedT) * 0.5;

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
  const range = PALETTE_RANGES[palette] || PALETTE_RANGES.full;
  return (range[0] + t * (range[1] - range[0])) % 360;
}

function jitter(v){
  return chaos > 0 ? v + random(-chaos, chaos) : v;
}

function drawMandalaStroke(x1, y1, x2, y2){
  const p1 = toBufferSpace(x1, y1);
  const p2 = toBufferSpace(x2, y2);
  const cx = bufferSize / 2, cy = bufferSize / 2;
  const dx = p2.x - cx, dy = p2.y - cy;
  const pdx = p1.x - cx, pdy = p1.y - cy;
  const speed = hypot(x2 - x1, y2 - y1);

  let sw = brushSize + (reactToSpeed ? min(speed * 0.6, 22) : 0);
  if (pulseBrush){
    sw += sin(frameCount * 0.12) * (brushSize * 0.5);
    sw = max(sw, 1);
  }

  let strokeColour; // {h,s,b,a} — alpha on p5's 0..100 scale
  if (colourMode === 'rainbow'){
    const t = ((hueShift + (reactToSpeed ? speed * 4 : 0)) % 360) / 360;
    strokeColour = { h: paletteHue(t), s: 75, b: 100, a: 92 };
    hueShift = (hueShift + 0.7) % 360;
  } else if (colourMode === 'gradient'){
    const d = hypot(dx, dy);
    const maxD = hypot(cx, cy);
    const t = constrain(d / maxD, 0, 1);
    strokeColour = { h: paletteHue(t), s: 75, b: 100, a: 92 };
  } else {
    strokeColour = hexToHSB(solidColourHex);
  }

  const angleStep = TWO_PI / symmetry;
  let ang = 0;
  for (let i = 0; i < symmetry; i++){
    ang += angleStep;
    const cosA = cos(ang), sinA = sin(ang);
    drawArm(pdx, pdy, dx, dy, sw, strokeColour, cx, cy, cosA, sinA, false);
    if (mirror){
      drawArm(pdx, pdy, dx, dy, sw, strokeColour, cx, cy, cosA, sinA, true);
    }
  }
}

// one symmetry arm: apply chaos jitter in local (pre-rotation) space like
// the p5 version, then rotate/mirror into art-buffer world space on the CPU
function drawArm(pdx, pdy, dx, dy, sw, col, cx, cy, cosA, sinA, mirrored){
  let jpdx = jitter(pdx), jpdy = jitter(pdy), jdx = jitter(dx), jdy = jitter(dy);
  if (mirrored){ jpdy = -jpdy; jdy = -jdy; }
  const ax = cx + jpdx * cosA - jpdy * sinA;
  const ay = cy + jpdx * sinA + jpdy * cosA;
  const bx = cx + jdx * cosA - jdy * sinA;
  const by = cy + jdx * sinA + jdy * cosA;

  // world space directly (the p5 version spawns in arm-local space and
  // converts through the active canvas transform — same end result)
  maybeSpawnParticles(bx, by, col);

  const [r, g, b] = hsbToRgb(col.h, col.s, col.b);
  const a = col.a / 100;
  const glow = glowIntensity;

  if (strokeStyleMode === 'line'){
    emitCapsule(ax, ay, bx, by, sw / 2, glow, r, g, b, a);

  } else if (strokeStyleMode === 'ribbon'){
    emitCapsule(ax, ay, bx, by, (sw * 2.2) / 2, glow, r, g, b, 0.28);
    emitCapsule(ax, ay, bx, by, max(sw * 0.4, 1) / 2, glow, r, g, b, a);

  } else if (strokeStyleMode === 'dots'){
    emitCapsule(bx, by, bx, by, sw / 2, glow, r, g, b, a);

  } else if (strokeStyleMode === 'sparkle'){
    // soft halo standing in for the star's shadowBlur, then the star itself
    if (glow > 0){
      emitCapsule(bx, by, bx, by, 0, glow + sw * 0.5, r, g, b, a);
    }
    emitStar(bx, by, sw * 0.4, sw * 1.3, 4, r, g, b, a);
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
    emitCapsule(p.x, p.y, p.x, p.y, 1.5, 0, r, g, b, (p.life / 255) * 0.9);
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
  trailMode = m.trailMode;
  document.querySelector('input[name="trail"][value="' + trailMode + '"]').checked = true;
  fadeSpeed = m.fadeSpeed; $('fadeSpeed').value = fadeSpeed; $('fadeVal').textContent = fadeSpeed;
  cycleBuildSeconds = m.cycleBuildSeconds; $('cycleBuildSeconds').value = cycleBuildSeconds; $('cycleBuildVal').textContent = cycleBuildSeconds + 's';
  bgColourHex = m.bgColourHex; $('bgColorPicker').value = bgColourHex;
  bgColour = hexToHSB(bgColourHex);
  applyThemeFromBg(bgColourHex);
  palette = m.palette; $('palette').value = palette;
  glowIntensity = m.glowIntensity; $('glow').value = glowIntensity; $('glowVal').textContent = glowIntensity;
  pulseBrush = m.pulseBrush; $('pulseBrush').checked = pulseBrush;
  strokeStyleMode = m.strokeStyleMode; $('strokeStyle').value = strokeStyleMode;
  autoRotate = m.autoRotate; $('autoRotate').checked = autoRotate;
  rotateSpeed = m.rotateSpeed; userRotateSpeed = rotateSpeed;
  $('rotateSpeed').value = rotateSpeed; $('rotateVal').textContent = rotateSpeed.toFixed(2);
  chaos = m.chaos; $('chaos').value = chaos; $('chaosVal').textContent = chaos;
  sparkleDust = m.sparkleDust; $('sparkleDust').checked = sparkleDust;
  idleDraw = m.idleDraw; $('idleDraw').checked = idleDraw;
  doubleIdlePattern = m.doubleIdlePattern; $('doubleIdlePattern').checked = doubleIdlePattern;

  $('solidColorGroup').style.display = colourMode === 'solid' ? 'block' : 'none';
  $('paletteGroup').style.display = colourMode === 'solid' ? 'none' : 'block';
  $('fadeGroup').style.display = (trailMode === 'fade' || trailMode === 'cycle') ? 'block' : 'none';
  $('cycleGroup').style.display = trailMode === 'cycle' ? 'block' : 'none';
  $('rotateGroup').style.display = autoRotate ? 'block' : 'none';
  if (trailMode === 'cycle') resetCyclePhase();

  // repaint the trail buffer in the loaded background colour (main.js does
  // this for the p5 path; here the renderer owns it)
  if (gl && !contextLost){
    clearArt();
  }
  lastX = null; lastY = null;
}

function currentMandalaState(){
  return {
    symmetry, mirror, brushSize, reactToSpeed, colourMode, solidColourHex,
    trailMode, fadeSpeed, cycleBuildSeconds, bgColourHex, palette, glowIntensity, pulseBrush,
    strokeStyleMode, autoRotate, rotateSpeed, chaos, sparkleDust, idleDraw,
    doubleIdlePattern
  };
}

function saveMandalaState(){
  MandalaStorage.patch('mandala', currentMandalaState());
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
  neon: { symmetry: 16, mirror: true, strokeStyleMode: 'line', colourMode: 'rainbow', palette: 'full', glowIntensity: 18, chaos: 0, trailMode: 'fade', fadeSpeed: 10 },
  gold: { symmetry: 8, mirror: true, strokeStyleMode: 'ribbon', colourMode: 'solid', solidColourHex: '#f2c14e', glowIntensity: 14, chaos: 0, trailMode: 'permanent' },
  ocean: { symmetry: 24, mirror: false, strokeStyleMode: 'dots', colourMode: 'gradient', palette: 'ocean', glowIntensity: 12, chaos: 0, trailMode: 'fade', fadeSpeed: 6 },
  chaosBloom: { symmetry: 10, mirror: true, strokeStyleMode: 'sparkle', colourMode: 'rainbow', palette: 'sunset', glowIntensity: 20, chaos: 22, trailMode: 'fade', fadeSpeed: 14 }
};

function applyPreset(name){
  const p = PRESETS[name];
  if (!p) return;
  const $ = (id) => document.getElementById(id);

  if (p.symmetry !== undefined){ symmetry = p.symmetry; $('symmetry').value = symmetry; $('symmetryVal').textContent = symmetry; }
  if (p.mirror !== undefined){ mirror = p.mirror; $('mirror').checked = mirror; }
  if (p.strokeStyleMode !== undefined){ strokeStyleMode = p.strokeStyleMode; $('strokeStyle').value = strokeStyleMode; }
  if (p.colourMode !== undefined){
    colourMode = p.colourMode; $('colourMode').value = colourMode;
    $('solidColorGroup').style.display = colourMode === 'solid' ? 'block' : 'none';
    $('paletteGroup').style.display = colourMode === 'solid' ? 'none' : 'block';
  }
  if (p.palette !== undefined){ palette = p.palette; $('palette').value = palette; }
  if (p.solidColourHex !== undefined){ solidColourHex = p.solidColourHex; $('solidColor').value = solidColourHex; }
  if (p.glowIntensity !== undefined){ glowIntensity = p.glowIntensity; $('glow').value = glowIntensity; $('glowVal').textContent = glowIntensity; }
  if (p.chaos !== undefined){ chaos = p.chaos; $('chaos').value = chaos; $('chaosVal').textContent = chaos; }
  if (p.trailMode !== undefined){
    trailMode = p.trailMode;
    const radio = document.querySelector('input[name="trail"][value="' + trailMode + '"]');
    if (radio) radio.checked = true;
    $('fadeGroup').style.display = (trailMode === 'fade' || trailMode === 'cycle') ? 'block' : 'none';
    $('cycleGroup').style.display = trailMode === 'cycle' ? 'block' : 'none';
    if (trailMode === 'cycle') resetCyclePhase();
  }
  if (p.fadeSpeed !== undefined){ fadeSpeed = p.fadeSpeed; $('fadeSpeed').value = fadeSpeed; $('fadeVal').textContent = fadeSpeed; }
  saveMandalaState();
}

// ---------- panel wiring (identical to sketch.js apart from renderer calls) ----------
function wireUpPanel(){
  const $ = (id) => document.getElementById(id);

  const panel = $('panel');
  const toggle = $('panel-toggle');
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

  $('strokeStyle').addEventListener('change', (e) => { strokeStyleMode = e.target.value; saveMandalaState(); });

  $('chaos').addEventListener('input', (e) => {
    chaos = parseInt(e.target.value, 10);
    $('chaosVal').textContent = chaos;
    saveMandalaState();
  });

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
    saveMandalaState();
  });

  $('palette').addEventListener('change', (e) => { palette = e.target.value; saveMandalaState(); });
  $('solidColor').addEventListener('input', (e) => { solidColourHex = e.target.value; saveMandalaState(); });

  $('glow').addEventListener('input', (e) => {
    glowIntensity = parseInt(e.target.value, 10);
    $('glowVal').textContent = glowIntensity;
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

  $('clearBtn').addEventListener('click', () => { clearArt(); });
  $('saveBtn').addEventListener('click', () => { saveImage(); });
  $('randomBtn').addEventListener('click', () => randomizeSettings($));

  $('presetNeon').addEventListener('click', () => applyPreset('neon'));
  $('presetGold').addEventListener('click', () => applyPreset('gold'));
  $('presetOcean').addEventListener('click', () => applyPreset('ocean'));
  $('presetChaos').addEventListener('click', () => applyPreset('chaosBloom'));
}

function randomizeSettings($){
  symmetry = floor(random(4, 41));
  $('symmetry').value = symmetry;
  $('symmetryVal').textContent = symmetry;

  mirror = random() > 0.35;
  $('mirror').checked = mirror;

  strokeStyleMode = random(['line', 'ribbon', 'dots', 'sparkle']);
  $('strokeStyle').value = strokeStyleMode;

  pulseBrush = random() > 0.5;
  $('pulseBrush').checked = pulseBrush;

  chaos = random() > 0.6 ? floor(random(5, 30)) : 0;
  $('chaos').value = chaos;
  $('chaosVal').textContent = chaos;

  colourMode = random(['rainbow', 'gradient', 'solid']);
  $('colourMode').value = colourMode;
  $('solidColorGroup').style.display = colourMode === 'solid' ? 'block' : 'none';
  $('paletteGroup').style.display = colourMode === 'solid' ? 'none' : 'block';

  palette = random(['full', 'sunset', 'ocean', 'forest', 'mono']);
  $('palette').value = palette;

  glowIntensity = floor(random(4, 24));
  $('glow').value = glowIntensity;
  $('glowVal').textContent = glowIntensity;

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
  window.setBreathingRotate = setBreathingRotate;

  const flavour = (isWebGL2 ? 'WebGL2' : 'WebGL1') + (floatTrails ? ' (float trails)' : ' (8-bit trails)');
  document.documentElement.dataset.renderer = 'webgl';
  console.info('Mandala renderer: ' + flavour);

  rafId = requestAnimationFrame(frame);
  return true;
}

window.MandalaWebGL = { start };
})();
