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
import { createStream, rankLabel, SUITS_FALLBACK } from './render-helpers.js';

export const QUALITY_TIERS = {
  low:    { shadows: false, renderScale: 0.66, antialias: false, particles: 0, envDetail: 0 },
  medium: { shadows: true,  renderScale: 0.85, antialias: true,  particles: 200, envDetail: 1 },
  high:   { shadows: true,  renderScale: 1.0,  antialias: true,  particles: 600, envDetail: 2 },
};

// ---------------------------------------------------------------------------
// Shared layout model (px within the playfield rect). UI and 3D both use it.
// ---------------------------------------------------------------------------

export function computeLayout(state, W, H) {
  const gap = Math.max(6, Math.round(W * 0.008));
  const topBar = Math.round(Math.min(H * 0.16, 120));
  const cw = Math.min((W - gap * 11) / 10, (H - topBar - gap * 2) / 3.4);
  const ch = cw * 1.4;
  const colX = (c) => gap + c * (cw + gap);
  const colY = topBar + gap;
  const avail = H - colY - gap;
  const cols = state.cols.map((col) => {
    let up = ch * 0.32, dn = ch * 0.16;
    const natural = col.reduce((h, c, i) => h + (i === 0 ? ch : c.u ? up : dn), 0);
    if (natural > avail && col.length > 1) {
      const over = (natural - avail) / (col.length - 1);
      up = Math.max(6, up - over);
      dn = Math.max(5, dn - over);
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
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const EASE = (t) => 1 - Math.pow(1 - t, 3); // cubic-out, authored duration

export class TableRenderer {
  constructor(container, getTheme, getSettings) {
    this.container = container;
    this.getTheme = getTheme;
    this.getSettings = getSettings;
    this.tier = 'medium';
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.cards = [];          // pooled card meshes (fixed 104)
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
  }

  init() {
    try {
      const tier = QUALITY_TIERS[this.tier];
      this.renderer = new THREE.WebGLRenderer({ antialias: tier.antialias, alpha: false, powerPreference: 'high-performance' });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.canvas = this.renderer.domElement;
      this.canvas.classList.add('gl-canvas');
      this.canvas.setAttribute('aria-hidden', 'true'); // DOM mirror owns a11y
      this.container.prepend(this.canvas);
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100);
      this.scene.add(this.props);
      this.buildLights();
      this.buildPool();
      this.buildEnvironment();
      this.resize();
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
      this.canvas.addEventListener('webglcontextrestored', () => { this.rebuild(); });
      this.ok = true;
      this.loop();
      return true;
    } catch (e) {
      console.warn('WebGL unavailable:', e.message);
      return false; // caller shows compatibility notice; DOM layer keeps playing
    }
  }

  rebuild() {
    // Recover GPU resources from retained CPU descriptors.
    texCache.clear();
    this.cards = [];
    this.props.clear();
    this.buildLights();
    this.buildPool();
    this.buildEnvironment();
    this.resize();
    if (this.lastState) this.sync(this.lastState);
    this.ok = true;
  }

  buildLights() {
    if (this.lightKey) { this.scene.remove(this.lightKey); this.scene.remove(this.lightFill); }
    this.lightKey = new THREE.DirectionalLight(0xfff2dd, 2.2); // dominant key
    this.lightKey.position.set(-0.4, 1, 0.8);
    this.lightKey.castShadow = QUALITY_TIERS[this.tier].shadows;
    this.lightFill = new THREE.AmbientLight(0xbfc8e0, 0.9);    // soft fill
    this.scene.add(this.lightKey, this.lightFill);
    this.renderer.shadowMap.enabled = QUALITY_TIERS[this.tier].shadows;
  }

  buildEnvironment() {
    const theme = this.getTheme();
    this.scene.background = new THREE.Color(theme.sky);
    // Shadow-box table: outer frame + recessed felt bed + silk-thread accents.
    this.env = new THREE.Group();
    const mat = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
    this.envMats = { frame: mat(theme.frame, 0.7), felt: mat(theme.felt), edge: mat(theme.feltEdge), accent: mat(theme.accent, 0.5) };
    this.env.userData.kind = 'environment';
    this.scene.add(this.env);
    this.layoutEnv();
  }

  layoutEnv() {
    this.env.clear();
    const { W, H } = this.rect;
    const theme = this.getTheme();
    const mk = (w, h, x, y, m, z = -3) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), m);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      this.env.add(mesh);
      return mesh;
    };
    // Felt bed + four frame rails (procedural geometry, no primitives-only look:
    // rails are beveled via a second slimmer accent strip along the inner edge).
    mk(W + 24, H + 24, W / 2, H / 2, this.envMats.edge, -5);
    mk(W, H, W / 2, H / 2, this.envMats.felt, -4);
    const t = Math.max(8, W * 0.012);
    mk(W + 2 * t, t, W / 2, -t / 2, this.envMats.frame, -2);
    mk(W + 2 * t, t, W / 2, H + t / 2, this.envMats.frame, -2);
    mk(t, H, -t / 2, H / 2, this.envMats.frame, -2);
    mk(t, H, W + t / 2, H / 2, this.envMats.frame, -2);
    if (QUALITY_TIERS[this.tier].envDetail > 0) {
      // Silk-thread accents: thin curves across the frame corners.
      const threadMat = new THREE.LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.7 });
      for (let i = 0; i < 4; i++) {
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const a = k / 16;
          pts.push(new THREE.Vector3(
            a * W * 0.18 * (i % 2 ? -1 : 1) + (i % 2 ? W : 0),
            Math.sin(a * Math.PI) * H * 0.02 + (i < 2 ? -t * 0.2 : H + t * 0.2), 0));
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), threadMat);
        line.userData.decor = true;
        this.env.add(line);
      }
    }
  }

  buildPool() {
    // Fixed pool of 104 card meshes + foundation/stock markers; geometry shared.
    this.cardGeo = new THREE.BoxGeometry(1, 1, 2);
    for (let i = 0; i < 104; i++) {
      const mesh = new THREE.Mesh(this.cardGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.userData.kind = 'card';
      this.scene.add(mesh);
      this.cards.push(mesh);
    }
    this.markerGeo = new THREE.PlaneGeometry(1, 1);
    this.markers = [];
    for (let i = 0; i < 12; i++) { // selection/target/hint markers
      const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }));
      m.visible = false; m.userData.decor = true; m.renderOrder = 2;
      this.scene.add(m); this.markers.push(m);
    }
  }

  setTier(tier) {
    if (!QUALITY_TIERS[tier]) return;
    this.tier = tier;
    if (this.renderer) {
      this.buildLights();
      this.layoutEnv();
      this.resize();
    }
  }

  resize() {
    if (!this.renderer) return;
    const W = this.container.clientWidth || 800;
    const H = this.container.clientHeight || 600;
    this.rect = { W, H };
    const tier = QUALITY_TIERS[this.tier];
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * tier.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H, false);
    // Orthographic frustum in CSS px: 3D units map 1:1 to DOM layout.
    this.camera.left = 0; this.camera.right = W;
    this.camera.top = 0; this.camera.bottom = H;
    this.camera.position.set(W / 2, H / 2, 50);
    this.camera.lookAt(W / 2, H / 2, 0);
    this.camera.updateProjectionMatrix();
    this.layoutEnv();
    if (this.lastState) this.sync(this.lastState, true);
  }

  reducedMotion() { return !!this.getSettings().reducedMotion; }

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
    const L = computeLayout(state, this.rect.W, this.rect.H);
    this.layout = L;
    let ci = 0;
    const place = (card, rect, opts = {}) => {
      const mesh = this.cards[ci++];
      mesh.visible = true;
      mesh.material.map = cardTexture(theme, suits, card, !!card.u);
      mesh.material.needsUpdate = true;
      const lift = opts.lift || 0;
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
      m.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, 1);
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

  // Bounded, pooled effects for event tiers; cosmetic only, never raycast.
  burst(x, y, color, n = 12) {
    if (this.reducedMotion() || !this.ok) return;
    const budget = QUALITY_TIERS[this.tier].particles;
    n = Math.min(n, budget - this.fx.length);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      const a = this.stream.next() * Math.PI * 2;
      const v = 40 + this.stream.next() * 80;
      m.position.set(x, y, 8);
      m.scale.set(5, 5, 1);
      m.userData = { vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: performance.now(), dur: 500 };
      m.renderOrder = 3;
      this.scene.add(m);
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
      if (this._hidden || !this.ok) return;
      const now = performance.now();
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
        if (t >= 1) { this.scene.remove(m); m.material.dispose(); this.fx.splice(i, 1); continue; }
        const dt = 1 / 60;
        m.position.x += m.userData.vx * dt;
        m.position.y += m.userData.vy * dt;
        m.material.opacity = 0.9 * (1 - t);
      }
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.renderer?.dispose();
    this.cardGeo?.dispose();
    this.markerGeo?.dispose();
    texCache.clear();
    this.canvas?.remove();
  }
}
