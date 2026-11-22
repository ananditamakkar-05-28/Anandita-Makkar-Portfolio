/* Confocal stage — a single persistent Three.js scene behind the whole site.
 *
 *   · Three instanced layers, one draw call each:
 *       FITC cytoplasm  ·  DAPI nuclei  ·  TRITC puncta
 *   · Drift and wrapping happen in the vertex shader (no per-frame matrices).
 *   · Each instance computes its own circle of confusion against a focus
 *     plane, so scrolling the home page pulls focus through the z-stack.
 *   · The canvas is transparent, so the page's own --bg is the background.
 *     Dark theme: additive blending + UnrealBloom, glowing on near-black.
 *     Light theme: the darker light-mode channel colours laid over the pale
 *     page with normal blending and no bloom — a stained brightfield slide.
 *   · Route changes lerp the three channel weights.
 *
 * No text is ever drawn in WebGL. The disc frame, tick ring, scale bar and
 * channel labels are the original HTML, sitting on top.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const root = document.documentElement;
const canvas = document.getElementById('stage');
const scrim = document.getElementById('scrim');
if (!canvas || !window.__hasWebGL) throw new Error('confocal stage: skipped');

const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = window.matchMedia && matchMedia('(max-width: 820px), (pointer: coarse)').matches;

/* ---- channel palette, read from the CSS variables ------------------------ */

const CH = ['dapi', 'fitc', 'tritc'];
function palette() {
  const cs = getComputedStyle(root);
  const dark = cs.getPropertyValue('--is-dark').trim() === '1';
  const col = {};
  CH.forEach(k => { col[k] = new THREE.Color(cs.getPropertyValue('--' + k).trim() || '#888'); });
  return { dark, col };
}
let theme = palette();

/* ---- renderer ------------------------------------------------------------ */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  root.classList.remove('gl');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
// The canvas stays transparent so the page's own --bg is the background in
// both themes — no clear colour to keep in sync, and no colour-space drift.
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
camera.position.set(0, 0, 6);

/* ---- geometry ------------------------------------------------------------ */

const CELLS = reduce ? 120 : (phone ? 55 : 200);
const PER_CELL = phone ? 3 : 5;               // TRITC puncta per cell
const Z_NEAR = -5, Z_FAR = -26;

const rnd = (a, b) => a + Math.random() * (b - a);

const cell = { pos: [], vel: [], size: [], seed: [] };
for (let i = 0; i < CELLS; i++) {
  cell.pos.push([rnd(-24, 24), rnd(-16, 16), rnd(Z_FAR, Z_NEAR)]);
  cell.vel.push([rnd(-0.055, 0.055), rnd(-0.045, 0.045), 0]);
  cell.size.push(rnd(0.5, 1.15));
  cell.seed.push(Math.random());
}

const BOUNDS = new THREE.Vector2(26, 18);

function layer(count, fill, opts) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  g.instanceCount = count;

  const aPos = new Float32Array(count * 3);
  const aVel = new Float32Array(count * 3);
  const aSize = new Float32Array(count);
  const aSeed = new Float32Array(count);
  fill(aPos, aVel, aSize, aSeed);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  g.setAttribute('aVel', new THREE.InstancedBufferAttribute(aVel, 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 1));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:    { value: 0 },
      uBounds:  { value: BOUNDS },
      uFocus:   { value: -15 },
      uCoc:     { value: opts.coc },
      uColor:   { value: new THREE.Color(0xffffff) },
      uWeight:  { value: 1 },
      uOpacity: { value: opts.opacity },
      uCore:    { value: opts.core },
      uEdge:    { value: opts.edge },
      uWobble:  { value: opts.wobble },
      uGrow:    { value: opts.grow },
    },
    vertexShader: `
      attribute vec3 aPos;
      attribute vec3 aVel;
      attribute float aSize;
      attribute float aSeed;
      uniform float uTime, uFocus, uCoc, uGrow;
      uniform vec2 uBounds;
      varying vec2 vUv;
      varying float vCoc, vSeed;
      void main(){
        vec3 p = aPos + aVel * uTime;
        p.x = mod(p.x + uBounds.x, 2.0 * uBounds.x) - uBounds.x;
        p.y = mod(p.y + uBounds.y, 2.0 * uBounds.y) - uBounds.y;
        float coc = clamp(abs(p.z - uFocus) * uCoc, 0.0, 1.0);
        float size = aSize * (1.0 + coc * uGrow);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;
        vUv = uv; vCoc = coc; vSeed = aSeed;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uWeight, uOpacity, uCore, uEdge, uWobble, uTime;
      varying vec2 vUv;
      varying float vCoc, vSeed;
      void main(){
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        if (uWobble > 0.0) {
          float a = atan(d.y, d.x);
          float w = 1.0
            + uWobble * sin(a * 3.0 + vSeed * 6.2831 + uTime * 0.22)
            + uWobble * 0.65 * sin(a * 5.0 - vSeed * 3.1 - uTime * 0.17);
          r /= max(w, 0.35);
        }
        float soft = mix(uEdge, 1.0, vCoc);
        float i = 1.0 - smoothstep(1.0 - soft, 1.0, r);
        i = pow(max(i, 0.0), uCore);
        i *= uOpacity * uWeight * (1.0 - vCoc * 0.55);
        if (i <= 0.003) discard;
        gl_FragColor = vec4(uColor, i);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });

  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.order;
  scene.add(mesh);
  return mesh;
}

/* FITC — soft cytoplasm / membrane */
const fitc = layer(CELLS, (p, v, s, sd) => {
  for (let i = 0; i < CELLS; i++) {
    p.set(cell.pos[i], i * 3); v.set(cell.vel[i], i * 3);
    s[i] = cell.size[i] * 2.0; sd[i] = cell.seed[i];
  }
}, { coc: 0.055, opacity: 0.26, core: 1.6, edge: 0.95, wobble: 0.11, grow: 1.25, order: 0 });

/* DAPI — bright nuclei */
const dapi = layer(CELLS, (p, v, s, sd) => {
  for (let i = 0; i < CELLS; i++) {
    const c = cell.pos[i];
    p.set([c[0] + rnd(-0.18, 0.18), c[1] + rnd(-0.18, 0.18), c[2]], i * 3);
    v.set(cell.vel[i], i * 3);
    s[i] = cell.size[i] * 0.72; sd[i] = cell.seed[i];
  }
}, { coc: 0.055, opacity: 0.72, core: 2.4, edge: 0.55, wobble: 0.05, grow: 1.6, order: 1 });

/* TRITC — small puncta scattered over each cell */
const PUNCTA = CELLS * PER_CELL;
const tritc = layer(PUNCTA, (p, v, s, sd) => {
  for (let i = 0; i < PUNCTA; i++) {
    const k = (i / PER_CELL) | 0, c = cell.pos[k], rad = cell.size[k] * 0.95;
    const a = Math.random() * 6.2831, d = Math.sqrt(Math.random()) * rad;
    p.set([c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, c[2] + rnd(-0.2, 0.2)], i * 3);
    v.set(cell.vel[k], i * 3);
    s[i] = rnd(0.05, 0.11); sd[i] = Math.random();
  }
}, { coc: 0.055, opacity: 0.95, core: 1.1, edge: 0.85, wobble: 0, grow: 2.4, order: 2 });

const layers = { fitc, dapi, tritc };
const mats = [fitc.material, dapi.material, tritc.material];

/* ---- post-processing ----------------------------------------------------- */

const useBloom = !phone;
let composer = null, bloom = null;
if (useBloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.7, 0.3);
  composer.addPass(bloom);
}

/* ---- theme --------------------------------------------------------------- */

function applyTheme() {
  theme = palette();
  mats.forEach(m => {
    // Dark: fluorescence, light adding on near-black.
    // Light: dark stains laid over the pale page, like a brightfield slide.
    m.blending = theme.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.needsUpdate = true;
  });
  fitc.material.uniforms.uColor.value.copy(theme.col.fitc);
  dapi.material.uniforms.uColor.value.copy(theme.col.dapi);
  tritc.material.uniforms.uColor.value.copy(theme.col.tritc);
  // Stains read heavier than fluorescence, so pull them back on light.
  fitc.material.uniforms.uOpacity.value = theme.dark ? 0.26 : 0.30;
  dapi.material.uniforms.uOpacity.value = theme.dark ? 0.72 : 0.62;
  tritc.material.uniforms.uOpacity.value = theme.dark ? 0.95 : 0.80;
  if (bloom) bloom.enabled = theme.dark;
  if (!running) draw();
}

/* ---- channel weights per route ------------------------------------------- */

const target = { dapi: 1, fitc: 1, tritc: 1 };
const current = { dapi: 1, fitc: 1, tritc: 1 };

function setRoute(route, channel) {
  if (route === 'home' || !channel) {
    target.dapi = 0.95; target.fitc = 0.95; target.tritc = 0.95;
  } else {
    CH.forEach(k => { target[k] = k === channel ? 1.0 : 0.22; });
  }
  onHome = route === 'home';
  placeHole();
  if (reduce) { CH.forEach(k => current[k] = target[k]); draw(); }
}

/* ---- the scrim hole over the hero disc ----------------------------------- */

const disc = document.querySelector('.field .disc');
let onHome = true;

function placeHole() {
  if (!scrim) return;
  if (!onHome || !disc || reduceHole()) { scrim.style.setProperty('--hr', '0px'); return; }
  const r = disc.getBoundingClientRect();
  if (!r.width) { scrim.style.setProperty('--hr', '0px'); return; }
  const s = scrim.getBoundingClientRect();
  scrim.style.setProperty('--hx', (r.left + r.width / 2 - s.left).toFixed(1) + 'px');
  scrim.style.setProperty('--hy', (r.top + r.height / 2 - s.top).toFixed(1) + 'px');
  scrim.style.setProperty('--hr', (r.width / 2).toFixed(1) + 'px');
}
function reduceHole() { return disc.offsetParent === null; }

/* ---- pointer parallax and the z-stack scroll ----------------------------- */

const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
if (!reduce) {
  window.addEventListener('pointermove', e => {
    mouse.tx = ((e.clientX - box.left) / box.width) * 2 - 1;
    mouse.ty = ((e.clientY - box.top) / box.height) * 2 - 1;
    tiltPosters(e);
  }, { passive: true });
}

const Z_MID = (Z_NEAR + Z_FAR) / 2;
let focusTarget = Z_MID;
function readScroll() {
  if (reduce || !onHome) { focusTarget = Z_MID; return; }
  const h = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const t = Math.min(1, Math.max(0, window.scrollY / h));
  focusTarget = Z_NEAR + (Z_FAR - Z_NEAR) * t;   // focus pulls from front to back
}

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; readScroll(); placeHole(); if (!running) draw(); });
}, { passive: true });

/* ---- poster cards -------------------------------------------------------- */

const posters = [].slice.call(document.querySelectorAll('.poster'));
posters.forEach((p, i) => { p.style.setProperty('--rx', '0deg'); p.style.setProperty('--ry', '0deg'); p.dataset.i = i; });

function tiltPosters(e) {
  if (!posters.length || phone) return;
  const grid = document.querySelector('.posters');
  if (!grid || grid.offsetParent === null) return;
  posters.forEach(p => {
    const r = p.getBoundingClientRect();
    if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = (e.clientX - cx) / Math.max(r.width, 1);
    const dy = (e.clientY - cy) / Math.max(r.height, 1);
    const near = Math.abs(dx) < 1.6 && Math.abs(dy) < 1.6;
    const k = near ? 7 : 2.2;
    p.classList.toggle('tilting', near);
    p.style.setProperty('--ry', (dx * k).toFixed(2) + 'deg');
    p.style.setProperty('--rx', (-dy * k).toFixed(2) + 'deg');
  });
}

/* ---- resize -------------------------------------------------------------- */

const box = { left: 0, top: 0, width: 1, height: 1 };

function resize() {
  const rect = canvas.getBoundingClientRect();
  box.left = rect.left; box.top = rect.top;
  box.width = rect.width || 1; box.height = rect.height || 1;
  const w = Math.round(box.width), h = Math.round(box.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(w, h);

  // Keep the drifting field a little wider than the far plane of the frustum.
  const dist = camera.position.z - Z_FAR;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  BOUNDS.set(halfH * camera.aspect * 1.2, halfH * 1.2);

  placeHole();
  if (!running) draw();
}
window.addEventListener('resize', resize);

/* ---- loop ---------------------------------------------------------------- */

const clock = new THREE.Clock();
let t = 0, running = false, raf = 0, last = 0;

function draw() {
  mats.forEach(m => { m.uniforms.uTime.value = t; m.uniforms.uFocus.value = focusNow; });
  fitc.material.uniforms.uWeight.value = current.fitc;
  dapi.material.uniforms.uWeight.value = current.dapi;
  tritc.material.uniforms.uWeight.value = current.tritc;
  if (composer && bloom && bloom.enabled) composer.render();
  else renderer.render(scene, camera);
}

let focusNow = Z_MID;

function frame(now) {
  raf = requestAnimationFrame(frame);
  if (document.hidden) return;
  // Off the hero, the field is only a backdrop — spend half the frames on it.
  if (!heroVisible && now - last < 32) return;
  last = now;

  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;

  mouse.x += (mouse.tx - mouse.x) * 0.045;
  mouse.y += (mouse.ty - mouse.y) * 0.045;
  camera.position.x = mouse.x * 1.1;
  camera.position.y = -mouse.y * 0.75;
  camera.lookAt(mouse.x * 0.25, -mouse.y * 0.18, Z_MID);

  focusNow += (focusTarget - focusNow) * 0.06;
  CH.forEach(k => { current[k] += (target[k] - current[k]) * 0.05; });

  draw();
}

/* Pause when the page is hidden; ease off when the hero scrolls away. */
let heroVisible = true;
const hero = document.querySelector('.hero');
if ('IntersectionObserver' in window && hero) {
  new IntersectionObserver(es => { heroVisible = es[0].isIntersecting; }, { threshold: 0 }).observe(hero);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) clock.getDelta(); });

/* ---- wire up ------------------------------------------------------------- */

document.addEventListener('am:route', e => setRoute(e.detail.route, e.detail.channel));
document.addEventListener('am:theme', applyTheme);

applyTheme();
const open = document.querySelector('.view:not([hidden])');
setRoute(open ? open.getAttribute('data-route') : 'home', open ? open.getAttribute('data-ch') : null);
CH.forEach(k => { current[k] = target[k]; });
resize();
readScroll();
focusNow = focusTarget;

if (reduce) {
  running = false;
  draw();                       // one still frame, no parallax, no z-stack
} else {
  running = true;
  clock.getDelta();
  raf = requestAnimationFrame(frame);
}

/* Fonts and images landing can shift the disc; re-measure once settled. */
window.addEventListener('load', () => { resize(); placeHole(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { resize(); placeHole(); });
