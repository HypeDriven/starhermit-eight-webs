// Eight Webs — render: Three.js shadow-box table scene.
// The canvas fills the game region but is never the only UI: the DOM layer
// (ui.js) renders interactive card equivalents using the SAME layout model
// exported here, so DOM labels align with projected 3D targets.
//
// Contract: render consumes immutable rules snapshots + a bounded event list.
// It never mutates rules state. Cosmetic randomness uses its own seeded
// stream. All motion derives from authored durations + easing, never
// cumulative per-frame lerp; reduced-motion settles everything instantly.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createStream, rankLabel } from './render-helpers.js';
import { detectPreset, describe, resolve, SHADOW_MAP, PARTICLE_BUDGET } from './gfx.js';

// ---------------------------------------------------------------------------
// Shared layout model (px within the playfield rect). UI and 3D both use it.
// ---------------------------------------------------------------------------

export function computeLayout(state, W, H, opts = {}) {
  const narrow = W < 480;
  const gap = narrow ? 3 : Math.max(6, Math.round(W * 0.008));
  const topBar = Math.round(Math.min(H * 0.16, 120));
  const cw = Math.min((W - gap * 11) / 10, (H - topBar - gap * 2) / 3.6);
  const ch = cw * 1.4;
  // Exposed strip of a face-up card = its tap target and its readable rank:
  // never thinner than the rank line, wider on touch screens.
  const minUp = opts.coarse ? 24 : 18;
  const colX = (c) => gap + c * (cw + gap);
  const colY = topBar + gap;
  const avail = H - colY - gap;
  const cols = state.cols.map((col) => {
    let up = Math.max(ch * 0.32, minUp), dn = ch * 0.16;
    const natural = col.reduce((h, c, i) => h + (i === 0 ? ch : c.u ? up : dn), 0);
    if (natural > avail && col.length > 1) {
      // Compress face-down cards first, then face-up ones down to the rank line.
      const over = (natural - avail) / (col.length - 1);
      dn = Math.max(4, dn - over);
      const stillOver = col.reduce((h, c, i) => h + (i === 0 ? ch : c.u ? up : dn), 0) - avail;
      if (stillOver > 0) {
        const ups = col.filter((c, i) => i > 0 && c.u).length || 1;
        // 13px keeps the rank line legible; below that the column would clip
        up = Math.max(Math.min(minUp, 13), up - stillOver / ups);
      }
    }
    const rects = [];
    let y = colY;
    for (let i = 0; i < col.length; i++) {
      rects.push({ x: colX(state.cols.indexOf(col)), y, w: cw, h: ch });
      y += col[i].u ? up : dn;
    }
    return rects;
  });
  // Recompute x by index (indexOf above is unsafe with duplicate empties).
  state.cols.forEach((col, c) => { for (const r of cols[c]) r.x = colX(c); });
  const pads = state.cols.map((col, c) => ({ x: colX(c), y: colY, w: cw, h: Math.max(ch, col.length ? (cols[c].at(-1).y + ch - colY) : ch) }));
  const stock = state.stock.map((_, i) => ({ x: gap + i * (cw * 0.35), y: gap, w: cw * 0.8, h: ch * 0.8 }));
  const foundations = [];
  for (let i = 0; i < 8; i++) {
    foundations.push({ x: W - gap - (8 - i) * (cw * 0.62), y: gap, w: cw * 0.55, h: ch * 0.8 });
  }
  return { cw, ch, gap, topBar, cols, pads, stock, foundations, W, H };
}

// ---------------------------------------------------------------------------
// Procedural card-face textures (authored, inspectable; no external assets)
// ---------------------------------------------------------------------------

const texCache = new Map();
function cardTexture(theme, suits, cardDef, faceUp) {
  const key = faceUp ? `f:${cardDef.r}:${cardDef.s}:${theme.card}` : `b:${theme.felt}`;
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 180;
  const g = cv.getContext('2d');
  const rr = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  if (!faceUp) {
    g.fillStyle = theme.felt; rr(2, 2, 124, 176, 10); g.fill();
    g.strokeStyle = theme.feltEdge; g.lineWidth = 4; rr(4, 4, 120, 172, 9); g.stroke();
    g.strokeStyle = theme.accent; g.lineWidth = 1.5; g.globalAlpha = 0.6;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(14, 30 + i * 30); g.bezierCurveTo(50, 20 + i * 30, 78, 40 + i * 30, 114, 30 + i * 30); g.stroke(); }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = theme.card; rr(2, 2, 124, 176, 10); g.fill();
    g.strokeStyle = theme.cardEdge; g.lineWidth = 3; rr(3, 3, 122, 174, 9); g.stroke();
    const suit = suits[cardDef.s % suits.length];
    g.fillStyle = suit.color;
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(rankLabel(cardDef.r), 10, 8);
    g.font = '52px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(suit.glyph, 64, 108);
    g.font = '22px system-ui, sans-serif';
    g.fillText(suit.glyph, 22, 52);
    // Corner index mirrored bottom-right for readability at any rotation.
    g.save(); g.translate(118, 170); g.rotate(Math.PI);
    g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(rankLabel(cardDef.r), 0, 0); g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // the world group mirrors y, so the canvas maps upright unflipped
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Procedural surface textures (felt fibres, wood grain, soft sprite). Seeded
// from the decor stream family so they never touch rules RNG; cached per theme.
// ---------------------------------------------------------------------------

const surfCache = new Map();

function feltTexture(theme) {
  const key = `felt:${theme.felt}`;
  if (surfCache.has(key)) return surfCache.get(key);
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = theme.felt; g.fillRect(0, 0, S, S);
  const rnd = createStream('decor:felt');
  // Short fibres drawn with wrap-around so the tile repeats seamlessly.
  for (let i = 0; i < 2600; i++) {
    const x = rnd.next() * S, y = rnd.next() * S;
    const a = rnd.next() * Math.PI, l = 2 + rnd.next() * 5;
    const light = rnd.next() < 0.5;
    g.strokeStyle = light ? `rgba(255,245,225,${0.015 + rnd.next() * 0.03})` : `rgba(0,0,0,${0.05 + rnd.next() * 0.08})`;
    g.lineWidth = 0.7;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  surfCache.set(key, tex);
  return tex;
}

function woodTexture(theme, vertical) {
  const key = `wood:${theme.frame}:${vertical ? 'v' : 'h'}`;
  if (surfCache.has(key)) return surfCache.get(key);
  let base = surfCache.get(`woodcv:${theme.frame}`);
  if (!base) {
    base = document.createElement('canvas');
    base.width = 256; base.height = 64;
    const g = base.getContext('2d');
    g.fillStyle = theme.frame; g.fillRect(0, 0, 256, 64);
    const rnd = createStream('decor:wood');
    for (let i = 0; i < 70; i++) {
      const y0 = rnd.next() * 64, amp = 1 + rnd.next() * 3, f = 1 + Math.floor(rnd.next() * 3);
      const dark = rnd.next() < 0.6;
      g.strokeStyle = dark ? `rgba(40,22,10,${0.08 + rnd.next() * 0.14})` : `rgba(255,230,190,${0.05 + rnd.next() * 0.08})`;
      g.lineWidth = 0.6 + rnd.next() * 1.4;
      g.beginPath();
      for (let x = 0; x <= 256; x += 4) {
        const y = y0 + Math.sin((x / 256) * Math.PI * 2 * f + i) * amp; // integer periods: seamless in x
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    surfCache.set(`woodcv:${theme.frame}`, base);
  }
  const tex = new THREE.CanvasTexture(base);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  if (vertical) { tex.center.set(0.5, 0.5); tex.rotation = Math.PI / 2; }
  surfCache.set(key, tex);
  return tex;
}

function spriteTexture() {
  if (surfCache.has('sprite')) return surfCache.get('sprite');
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  surfCache.set('sprite', tex);
  return tex;
}

// Colour grade + vignette (display-space in, display-space out): a gentle
// S-curve, a touch of saturation, warm highlights / cool shadows.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      vec3 lc = clamp(c, 0.0, 1.0);
      vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.08);
      s *= mix(vec3(0.97, 0.98, 1.04), vec3(1.04, 1.0, 0.95), smoothstep(0.2, 0.8, l));
      c = mix(c, s + max(c - 1.0, 0.0), uAmount);
      float d = length((vUv - 0.5) * vec2(1.0, 0.9));
      c *= 1.0 - uVignette * smoothstep(0.3, 0.8, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const EASE = (t) => 1 - Math.pow(1 - t, 3); // cubic-out, authored duration
const CARD_Z = 4;   // resting card height above the felt (casts a soft shadow)
const MOTES = 64;   // drifting silk motes (background: animated)

export class TableRenderer {
  constructor(container, getTheme, getSettings) {
    this.container = container;
    this.getTheme = getTheme;
    this.getSettings = getSettings;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.cards = [];          // pooled card meshes (fixed 104)
    // Layout space is y-down CSS px; the world group mirrors it into a y-up
    // scene (three flips face winding for the mirrored matrix).
    this.world = new THREE.Group();
    this.world.scale.y = -1;
    this.props = new THREE.Group();
    this.fx = [];
    this.stream = createStream('decor:table');
    this.anims = new Map();   // mesh -> {from,to,t0,dur}
    this.rect = { W: 800, H: 600 };
    this.lastState = null;
    this.selection = null;
    this.legalTargets = [];
    this.hint = null;
    this._raf = 0;
    this._hidden = false;
    this.ok = false;
    // Graphics settings
    this.saved = {};
    this._gfxJson = null;
    this.gpu = '';
    this.detected = 'balanced';
    this.q = resolve({}, this.detected);
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.pixelRatio = 1;
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;
    this.envTex = null;
    this._matKey = null;
  }

  init() {
    try {
      // Context MSAA stays off: Low renders plain, and MSAA (Ultra) runs on
      // the composer's multisampled target instead.
      this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.detectGpu();
      this.canvas = this.renderer.domElement;
      this.canvas.classList.add('gl-canvas');
      this.canvas.setAttribute('aria-hidden', 'true'); // DOM mirror owns a11y
      this.container.prepend(this.canvas);
      // Follow the playfield box (rails, chat sidebar, orientation) so the 3D
      // layout always matches the DOM cards drawn over it.
      if (typeof ResizeObserver === 'function') {
        this._ro = new ResizeObserver(() => { if (this.ok) this.resize(); });
        this._ro.observe(this.container);
      }
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 300);
      this.scene.add(this.world);
      this.world.add(this.props);
      this.buildLights();
      this.buildPool();
      this.buildEnvironment();
      this.buildMotes();
      this.applyGraphics();
      this.resize();
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
      this.canvas.addEventListener('webglcontextrestored', () => { this.rebuild(); });
      this.ok = true;
      this.loop();
      return true;
    } catch (e) {
      this.initError = e?.message || String(e);
      return false; // caller shows compatibility notice; DOM layer keeps playing
    }
  }

  detectGpu() {
    let name = '';
    try {
      const gl = this.renderer.getContext();
      name = String(gl.getParameter(gl.RENDERER) || '');
      // Chrome masks RENDERER; Firefox already reports the real device.
      if (!name || /^(webkit|mozilla)|webgl/i.test(name)) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || name);
      }
    } catch { /* keep the generic name */ }
    const mm = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
    const mobile = (mm('(pointer: coarse)') && !mm('(any-pointer: fine)'))
      || /Android|iPhone|iPad|Mobile/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    this.detected = detectPreset(name, { mobile });
    const inner = name.match(/^ANGLE \((.*)\)$/);
    const parts = inner ? inner[1].split(', ') : [name];
    this.gpu = (parts.length >= 3 ? parts[1] : parts.join(', ')).replace(/\s*\((0x[0-9a-f]+|Subzero)\)/gi, '').trim() || 'unknown GPU';
  }

  rebuild() {
    // Recover GPU resources from retained CPU descriptors.
    texCache.clear();
    surfCache.clear();
    this.envTex = null;
    this._matKey = null;
    this.composer?.dispose();
    this.composer = null;
    this.postKey = null;
    for (const m of this.cards) this.world.remove(m);
    for (const m of this.markers || []) this.world.remove(m);
    this.cards = [];
    this.props.clear();
    if (this.env) this.world.remove(this.env);
    this.buildLights();
    this.buildPool();
    this.buildEnvironment();
    this.buildMotes();
    this.applyGraphics();
    this.resize();
    if (this.lastState) this.sync(this.lastState);
    this.ok = true;
  }

  buildLights() {
    if (this.lightKey) this.scene.remove(this.lightKey, this.lightKey.target, this.lightFill, this.lightAmb);
    this.lightKey = new THREE.DirectionalLight(0xfff0dc, 2.0); // warm key from the upper left
    this.lightKey.shadow.bias = -0.0004;
    this.lightKey.shadow.radius = 3;
    this.lightFill = new THREE.HemisphereLight(0xfff6e8, 0x2a2119, 1.1); // sky/ground fill
    this.lightAmb = new THREE.AmbientLight(0xbfc8e0, 0.25);
    this.scene.add(this.lightKey, this.lightKey.target, this.lightFill, this.lightAmb);
  }

  // Key light and its shadow frustum are fitted to the playfield each resize.
  fitLights() {
    const { W, H } = this.rect;
    const cx = W / 2, cy = -H / 2;
    this.lightKey.target.position.set(cx, cy, 0);
    this.lightKey.position.set(cx - 0.35 * 150, cy + 0.55 * 150, 150);
    const r = Math.hypot(W, H) / 2 + 24;
    Object.assign(this.lightKey.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 400 });
    this.lightKey.shadow.camera.updateProjectionMatrix();
  }

  buildEnvironment() {
    this.env = new THREE.Group();
    this.env.userData.kind = 'environment';
    this.world.add(this.env);
    this.layoutEnv();
  }

  // Materials depend on theme + detail + reflections; rebuilt only when those change.
  envMaterials() {
    const theme = this.getTheme();
    const q = this.q;
    const detailed = q.detail === 'detailed';
    const key = [theme.id, theme.felt, q.detail, q.reflections].join('|');
    if (key === this._matKey) return this.envMats;
    this._matKey = key;
    for (const m of Object.values(this.envMats || {})) m.dispose();
    const refl = q.reflections === 'on';
    const envMap = refl ? this.envMap() : null; // per material, so envMapIntensity applies
    const felt = new THREE.MeshStandardMaterial({
      color: detailed ? 0xffffff : theme.felt, map: detailed ? feltTexture(theme) : null,
      bumpMap: detailed ? feltTexture(theme) : null, bumpScale: 0.6,
      roughness: 0.95, metalness: 0, envMap, envMapIntensity: 0.12,
    });
    const frameMat = (vertical) => new THREE.MeshPhysicalMaterial({
      color: detailed ? 0xffffff : theme.frame, map: detailed ? woodTexture(theme, vertical) : null,
      roughness: 0.6, metalness: 0, clearcoat: detailed ? 0.6 : 0, clearcoatRoughness: 0.25,
      envMap, envMapIntensity: 0.45,
    });
    this.envMats = {
      felt,
      edge: new THREE.MeshStandardMaterial({ color: theme.feltEdge, roughness: 0.9 }),
      frameH: frameMat(false),
      frameV: frameMat(true),
      inlay: new THREE.MeshStandardMaterial({ color: theme.accent, roughness: 0.3, metalness: refl ? 0.75 : 0.2, envMap, envMapIntensity: 1 }),
      silk: new THREE.LineBasicMaterial({ color: theme.card, transparent: true, opacity: 0.17, depthWrite: false }),
      thread: new THREE.LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.55, depthWrite: false }),
    };
    return this.envMats;
  }

  layoutEnv() {
    if (!this.env) return;
    for (const c of this.env.children) c.geometry?.dispose();
    this.env.clear();
    const { W, H } = this.rect;
    const theme = this.getTheme();
    if (this.scene) this.scene.background = new THREE.Color(theme.sky);
    const M = this.envMaterials();
    const detailed = this.q.detail === 'detailed';
    const mk = (w, h, x, y, m, z, d = 4) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      this.env.add(mesh);
      return mesh;
    };
    // Felt bed (fills the view) + frame rails whose inner lip shows inside
    // the playfield edge and throws a thin shadow onto the felt.
    mk(W + 48, H + 48, W / 2, H / 2, M.edge, -8);
    mk(W, H, W / 2, H / 2, M.felt, -4);
    if (M.felt.map) M.felt.map.repeat.set(W / 256, H / 256);
    const narrow = W < 480;
    const gap = narrow ? 3 : Math.max(6, Math.round(W * 0.008));
    const b = narrow ? 3 : Math.min(10, Math.max(4, gap * 0.75)); // visible lip
    const o = 16; // part hidden outside the view
    const rails = [
      mk(W + 2 * o, b + o, W / 2, (b - o) / 2, M.frameH, -1, 6),
      mk(W + 2 * o, b + o, W / 2, H - (b - o) / 2, M.frameH, -1, 6),
      mk(b + o, H, (b - o) / 2, H / 2, M.frameV, -1, 6),
      mk(b + o, H, W - (b - o) / 2, H / 2, M.frameV, -1, 6),
    ];
    for (const r of rails) {
      r.castShadow = true;
      if (r.material.map) r.material.map.repeat.set(Math.max(r.geometry.parameters.width, r.geometry.parameters.height) / 256, 1);
    }
    if (detailed && b >= 6) {
      // Brass-like inlay along the inner edge of the frame.
      const t = 1.5;
      mk(W - 2 * b, t, W / 2, b - t / 2, M.inlay, 2.2, 0.6);
      mk(W - 2 * b, t, W / 2, H - b + t / 2, M.inlay, 2.2, 0.6);
      mk(t, H - 2 * b, b - t / 2, H / 2, M.inlay, 2.2, 0.6);
      mk(t, H - 2 * b, W - b + t / 2, H / 2, M.inlay, 2.2, 0.6);
    }
    if (detailed) {
      // Corner webs: spokes and sagging silk rings in the two lower corners,
      // where the columns rarely reach. Faint, so cards always read first.
      const R = Math.min(W, H) * 0.3;
      const pts = [];
      for (const [cx, cy, a0] of [[b, H - b, -Math.PI / 2], [W - b, H - b, Math.PI]]) {
        const spokes = 7;
        const ang = (k) => a0 + (k / (spokes - 1)) * (Math.PI / 2);
        for (let k = 0; k < spokes; k++) {
          pts.push(cx, cy, -1.8, cx + Math.cos(ang(k)) * R, cy + Math.sin(ang(k)) * R, -1.8);
        }
        for (let ring = 1; ring <= 6; ring++) {
          const rr = (ring / 6.4) * R;
          for (let k = 0; k < spokes - 1; k++) {
            const p0 = [cx + Math.cos(ang(k)) * rr, cy + Math.sin(ang(k)) * rr];
            const p1 = [cx + Math.cos(ang(k + 1)) * rr, cy + Math.sin(ang(k + 1)) * rr];
            // Sag each strand toward the hub (quadratic, 6 segments).
            const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
            const sx = mx + (cx - mx) * 0.12, sy = my + (cy - my) * 0.12;
            let prev = p0;
            for (let s = 1; s <= 6; s++) {
              const t = s / 6, u = 1 - t;
              const p = [u * u * p0[0] + 2 * u * t * sx + t * t * p1[0], u * u * p0[1] + 2 * u * t * sy + t * t * p1[1]];
              pts.push(prev[0], prev[1], -1.8, p[0], p[1], -1.8);
              prev = p;
            }
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const web = new THREE.LineSegments(geo, M.silk);
      web.userData.decor = true;
      this.env.add(web);
    }
  }

  buildPool() {
    // Fixed pool of 104 card meshes + foundation/stock markers; geometry shared.
    this.cardGeo = new THREE.BoxGeometry(1, 1, 2);
    for (let i = 0; i < 104; i++) {
      const mesh = new THREE.Mesh(this.cardGeo, new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.6, envMapIntensity: 0.3 }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.userData.kind = 'card';
      this.world.add(mesh);
      this.cards.push(mesh);
    }
    this.markerGeo = new THREE.PlaneGeometry(1, 1);
    this.markers = [];
    for (let i = 0; i < 12; i++) { // selection/target/hint markers
      const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
      m.visible = false; m.userData.decor = true; m.renderOrder = 2;
      this.world.add(m); this.markers.push(m);
    }
  }

  // Drifting silk motes: additive points that glint (bloom picks up their HDR peaks).
  buildMotes() {
    if (this.motes) { this.world.remove(this.motes); this.motes.geometry.dispose(); this.motes.material.dispose(); }
    const pos = new Float32Array(MOTES * 3), col = new Float32Array(MOTES * 3);
    const rnd = createStream('decor:motes');
    this.moteData = [];
    for (let i = 0; i < MOTES; i++) {
      this.moteData.push({ x: rnd.next(), y: rnd.next(), vx: 3 + rnd.next() * 7, vy: -2 + rnd.next() * 4, ph: rnd.next() * 6.28, sp: 0.6 + rnd.next() * 1.4 });
      pos[i * 3 + 2] = 14;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 5, sizeAttenuation: false, map: spriteTexture(), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.motes.userData.decor = true;
    this.motes.renderOrder = 4;
    this.moteT = 0;
    this.world.add(this.motes);
  }

  updateMotes(dt) {
    if (!this.motes?.visible) return;
    const { W, H } = this.rect;
    const moving = !this.reducedMotion();
    if (moving) this.moteT += dt;
    const t = this.moteT;
    const pos = this.motes.geometry.attributes.position.array;
    const col = this.motes.geometry.attributes.color.array;
    const c = new THREE.Color(this.getTheme().card);
    for (let i = 0; i < MOTES; i++) {
      const m = this.moteData[i];
      const x = ((m.x * W + m.vx * t) % (W + 20) + (W + 20)) % (W + 20) - 10;
      const y = ((m.y * H + m.vy * t + Math.sin(t * 0.4 + m.ph) * 12) % (H + 20) + (H + 20)) % (H + 20) - 10;
      pos[i * 3] = x; pos[i * 3 + 1] = y;
      // Twinkle: mostly dim, brief HDR glints that the bloom pass catches.
      const tw = 0.5 + 0.5 * Math.sin(t * m.sp + m.ph);
      const k = 0.12 + 0.3 * tw + Math.pow(tw, 24) * 2.2;
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    this.motes.geometry.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------------- graphics settings

  /** Apply saved graphics settings (the `graphics` object from UI settings). */
  setGraphics(saved) {
    const json = JSON.stringify(saved || {});
    if (json === this._gfxJson) return; // unrelated settings changed
    this._gfxJson = json;
    this.saved = saved || {};
    this.applyGraphics();
  }

  applyGraphics() {
    const g = this.q = resolve(this.saved, this.detected);
    if (typeof document !== 'undefined') {
      document.body.dataset.gfxPreset = g.preset;
      document.body.dataset.gfxAuto = g.auto ? '1' : '0';
    }
    this._fpsVisible(g.showFps && !!this.renderer);
    if (!this.renderer || !this.scene) return;
    const size = SHADOW_MAP[g.shadows];
    this.renderer.shadowMap.enabled = size > 0;
    this.lightKey.castShadow = size > 0;
    this.lightKey.shadow.radius = g.shadows === 'high' ? 4 : g.shadows === 'medium' ? 3 : 2;
    if (size > 0 && this.lightKey.shadow.mapSize.x !== size) {
      this.lightKey.shadow.mapSize.set(size, size);
      this.lightKey.shadow.map?.dispose();
      this.lightKey.shadow.map = null;
    }
    const envMap = g.reflections === 'on' ? this.envMap() : null;
    for (const c of this.cards) c.material.envMap = envMap;
    if (this.motes) this.motes.visible = g.background === 'animated';
    this.layoutEnv();
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    // Materials pick up shadow/environment changes on recompile.
    this.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.needsUpdate = true;
    });
  }

  envMap() {
    if (this.envTex) return this.envTex;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.envTex = pmrem.fromScene(room, 0.04).texture;
      room.dispose?.();
      pmrem.dispose();
    } catch { this.envTex = null; }
    return this.envTex;
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
  graphicsInfo() {
    const { W, H } = this.rect;
    const px = [Math.round(W * this.pixelRatio), Math.round(H * this.pixelRatio)];
    return {
      ok: !!this.ok,
      gpu: this.gpu || 'unknown GPU',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, this.ok ? px : null),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  _postKey() {
    const g = this.q;
    const { W, H } = this.rect;
    return g.post ? [g.ao, g.bloom, g.grade, g.antialias, W, H, this.pixelRatio].join('|') : 'none';
  }

  _buildPost() {
    const g = this.q;
    const { W: w, H: h } = this.rect;
    this.composer?.dispose();
    this.composer = null;
    if (!g.post || this.postFailed) return;
    try {
      const pr = this.pixelRatio;
      const target = new THREE.WebGLRenderTarget(w * pr, h * pr, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, w * pr, h * pr);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        const hi = g.ao === 'high';
        ao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.2, thickness: 12, scale: 1.2, samples: hi ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only glints, sparks and highlights bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.45, 0.9));
      }
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(w * pr, h * pr));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly and say so in the panel.
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(dt) {
    const f = this._frames;
    f.push(dt);
    if (f.length < 90) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) { this.adaptiveScale = 1; return; }
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
  }

  _targetRatio() {
    const g = this.q;
    return Math.min(window.devicePixelRatio || 1, g.cap) * ((window.UIScale && UIScale.value) || 1) * g.scale * this.adaptiveScale;
  }

  resize() {
    if (!this.renderer) return;
    const W = this.container.clientWidth || 800;
    const H = this.container.clientHeight || 600;
    this.rect = { W, H };
    this.pixelRatio = this._targetRatio();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(W, H, false);
    // Orthographic frustum in CSS px: 3D units map 1:1 to DOM layout. The
    // world group mirrors y, so layout [0,W]x[0,H] (y down) is world
    // [0,W]x[-H,0], exactly the visible range.
    this.camera.left = -W / 2; this.camera.right = W / 2;
    this.camera.top = H / 2; this.camera.bottom = -H / 2;
    this.camera.position.set(W / 2, -H / 2, 100);
    this.camera.lookAt(W / 2, -H / 2, 0);
    this.camera.updateProjectionMatrix();
    this.fitLights();
    this.layoutEnv();
    if (this.lastState) this.sync(this.lastState, true);
  }

  reducedMotion() {
    return !!this.getSettings().reducedMotion
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Animate mesh to a pose over an authored duration; reduced motion = instant.
  flyTo(mesh, x, y, w, h, lift = 0) {
    const target = { x, y, w, h, lift };
    if (this.reducedMotion()) {
      mesh.position.set(x + w / 2, y + h / 2, lift);
      mesh.scale.set(w, h, 1);
      this.anims.delete(mesh);
      return;
    }
    this.anims.set(mesh, {
      from: { x: mesh.position.x - mesh.scale.x / 2, y: mesh.position.y - mesh.scale.y / 2, w: mesh.scale.x, h: mesh.scale.y, lift: mesh.position.z },
      to: target, t0: performance.now(), dur: 180,
    });
  }

  // Consume an immutable snapshot; settle every object to its exact end state.
  sync(state, instant = false) {
    if (!this.ok) return;
    this.lastState = state;
    const theme = this.getTheme();
    const suits = this.suits || [];
    const L = computeLayout(state, this.rect.W, this.rect.H, { coarse: typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches });
    this.layout = L;
    let ci = 0;
    const place = (card, rect, opts = {}) => {
      const mesh = this.cards[ci++];
      mesh.visible = true;
      const tex = cardTexture(theme, suits, card, !!card.u);
      if (mesh.material.map !== tex) { mesh.material.map = tex; mesh.material.needsUpdate = true; }
      const lift = CARD_Z + (opts.lift || 0);
      if (instant || this.reducedMotion()) {
        mesh.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, lift);
        mesh.scale.set(rect.w, rect.h, 1);
        this.anims.delete(mesh);
      } else if (!mesh.userData.placed) {
        mesh.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, lift);
        mesh.scale.set(rect.w, rect.h, 1);
        mesh.userData.placed = true;
      } else {
        this.flyTo(mesh, rect.x, rect.y, rect.w, rect.h, lift);
      }
      return mesh;
    };
    state.cols.forEach((col, c) => {
      col.forEach((card, i) => {
        const sel = this.selection && this.selection.from === c && i >= this.selection.idx;
        place(card, L.cols[c][i], { lift: sel ? 6 : 0 });
      });
    });
    for (const pk of L.stock) place({ r: 0, s: 0, u: 0 }, pk, {});
    const done = state.foundations;
    for (let i = 0; i < done && i < L.foundations.length; i++) {
      place({ r: 13, s: 0, u: 1 }, L.foundations[i], {});
    }
    for (; ci < this.cards.length; ci++) { this.cards[ci].visible = false; this.anims.delete(this.cards[ci]); }
    this.syncMarkers(L);
  }

  syncMarkers(L) {
    const theme = this.getTheme();
    let mi = 0;
    const show = (rect, color, opacity = 0.35, grow = 1.08) => {
      const m = this.markers[mi++];
      if (!m) return;
      m.visible = true;
      m.material.color.set(color);
      m.material.opacity = opacity;
      m.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, CARD_Z + 8);
      m.scale.set(rect.w * grow, rect.h * grow, 1);
    };
    if (this.selection) {
      const rects = L.cols[this.selection.from] || [];
      for (let i = this.selection.idx; i < rects.length; i++) show(rects[i], theme.select, 0.3);
      for (const to of this.legalTargets) show(L.pads[to], theme.legal, 0.18, 1.04);
    }
    if (this.hint) {
      const r1 = L.cols[this.hint.from]?.[this.hint.idx];
      if (r1) show(r1, theme.accent, 0.45);
      const r2 = L.pads[this.hint.to];
      if (r2) show(r2, theme.accent, 0.3, 1.05);
    }
    for (; mi < this.markers.length; mi++) this.markers[mi].visible = false;
  }

  setSelection(sel, legalTargets, hint) {
    this.selection = sel;
    this.legalTargets = legalTargets || [];
    this.hint = hint || null;
    if (this.lastState) this.sync(this.lastState, this.reducedMotion());
  }

  // Bounded effects for event tiers; cosmetic only, never raycast. On the
  // high particle tier sparks are additive with HDR colour so bloom lifts them.
  burst(x, y, color, n = 12) {
    if (this.reducedMotion() || !this.ok) return;
    const hi = this.q.particles === 'high';
    const budget = PARTICLE_BUDGET[this.q.particles];
    n = Math.min(hi ? Math.round(n * 1.5) : n, budget - this.fx.length);
    const c = new THREE.Color(color);
    if (hi) c.multiplyScalar(2.4);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({
        color: c, map: hi ? spriteTexture() : null, transparent: true, opacity: 0.9, depthWrite: false,
        blending: hi ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      const a = this.stream.next() * Math.PI * 2;
      const v = 40 + this.stream.next() * 80;
      m.position.set(x, y, 20);
      const s = hi ? 7 + this.stream.next() * 5 : 5;
      m.scale.set(s, s, 1);
      m.userData = { vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: performance.now(), dur: hi ? 700 : 500 };
      m.renderOrder = 3;
      this.world.add(m);
      this.fx.push(m);
    }
  }

  eventFx(e) {
    if (!this.layout) return;
    const theme = this.getTheme();
    if (e.type === 'run-complete') {
      const r = this.layout.pads[e.col];
      if (r) this.burst(r.x + r.w / 2, r.y + r.h / 2, theme.accent, 24);
    } else if (e.type === 'move') {
      const r = this.layout.pads[e.to];
      if (r) this.burst(r.x + r.w / 2, r.y + 10, theme.select, 5);
    } else if (e.type === 'deal') {
      this.burst(this.rect.W / 2, this.layout.topBar / 2, theme.legal, 16);
    } else if (e.type === 'win') {
      this.burst(this.rect.W / 2, this.rect.H / 2, theme.accent, 60);
    }
  }

  setSuits(suits) { this.suits = suits; }

  setHidden(hidden) {
    this._hidden = hidden; // background tabs drop rendering to a heartbeat
  }

  loop() {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      if (this._hidden || !this.ok) { this._last = 0; return; }
      const now = performance.now();
      const dt = this._last ? Math.min(250, now - this._last) : 16;
      this._last = now;
      this._adapt(dt);
      for (const [mesh, a] of this.anims) {
        const t = Math.min(1, (now - a.t0) / a.dur);
        const k = EASE(t);
        const x = a.from.x + (a.to.x - a.from.x) * k;
        const y = a.from.y + (a.to.y - a.from.y) * k;
        const w = a.from.w + (a.to.w - a.from.w) * k;
        const h = a.from.h + (a.to.h - a.from.h) * k;
        const z = a.from.lift + (a.to.lift - a.from.lift) * k;
        mesh.position.set(x + w / 2, y + h / 2, z);
        mesh.scale.set(w, h, 1);
        if (t >= 1) this.anims.delete(mesh); // settle to exact end state
      }
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const m = this.fx[i];
        const t = (now - m.userData.t0) / m.userData.dur;
        if (t >= 1) { this.world.remove(m); m.material.dispose(); this.fx.splice(i, 1); continue; }
        const step = dt / 1000;
        m.position.x += m.userData.vx * step;
        m.position.y += m.userData.vy * step;
        m.material.opacity = 0.9 * (1 - t);
      }
      this.updateMotes(dt / 1000);
      const ratio = this._targetRatio();
      if (Math.abs(ratio - this.pixelRatio) > 1e-3) {
        this.pixelRatio = ratio;
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(this.rect.W, this.rect.H, false);
      }
      const key = this._postKey();
      if (key !== this.postKey) { this.postKey = key; this._buildPost(); }
      if (this.composer) {
        try { this.composer.render(dt / 1000); }
        catch { this.postFailed = true; this.composer = null; }
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };
    tick();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this.composer?.dispose();
    this.renderer?.dispose();
    this.cardGeo?.dispose();
    this.markerGeo?.dispose();
    texCache.clear();
    surfCache.clear();
    this.canvas?.remove();
  }
}
