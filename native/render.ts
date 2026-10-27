// The shadow-box table on starhermit:scene, as the browser build's
// js/render.js drew it under its DOM card layer: the felt bed (fibre texture
// and bump on the detailed looks) with its darker edge, the wooden frame
// rails whose inner lip shows at the playfield's edge and throws a thin
// shadow, the brass inlay along it and the sagging silk webs in the two lower
// corners (detailed looks), the drifting, glinting silk motes (animated
// looks), and the bounded spark bursts at the column that changed (a move,
// a deal, a cleared web, the win). The theme recolours all of it; the look
// per graphics level (native/quality.ts) picks the material class, shadows,
// reflections and the post chain.
//
// The cards themselves are the UI's (native/screens.ts), drawn over this
// scene exactly where the browser build's opaque DOM cards covered its
// three.js card meshes, so the meshes (and their hidden selection markers)
// are not ported. The orthographic camera spans the whole window in the
// layout's logical pixels, with the playfield's top-left corner at the
// world origin (y up, so layout y is negated), as the browser build's
// canvas filled its playfield 1:1 with the DOM layout.
//
// Gaps and changes from three.js: light intensities are three.js's ÷ π (the
// engine's convention); the post chain is renderer.ao / bloom / grade /
// antialias (the grade the browser build's GradeShader in display space);
// the felt and wood canvases are baked once (tools/bake-textures.mjs →
// assets/textures/*.png) since the engine's canvas paints their thousands of
// strokes too slowly at start-up; the shadow reaches by distance (the
// engine's directional shadow fits the view); sparks move on the runtime's
// fixed steps (tick); adaptive resolution, the frame-rate meter and the
// pixel-ratio cap are the runtime's.
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, OrthographicCamera, PlaneGeometry,
  PMREMGenerator, Points, PointsMaterial, RepeatWrapping, RoomEnvironment, SRGBColorSpace, TextureLoader, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import { createStream } from "../js/rules.js";
import { MOTE_MAX, SPARK_MAX, type Look } from "./quality.ts";

const PI = Math.PI;
export interface Theme {
  id: string; paper: string; ink: string; rule: string; panel: string; felt: string; feltEdge: string; frame: string;
  card: string; cardEdge: string; accent: string; select: string; legal: string; danger: string; sky: string;
}

// -- renderer, camera and lights (js/render.js init / buildLights) ------------------------------
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// Workaround (engine 1.16.5): specular light under an orthographic camera follows the direction to the
// camera's position (three.js takes the view axis), so a camera 100 px above the felt put a bright
// highlight on the brass inlay. Far away, the direction is all but the view axis again.
const CAM_Z = 2000;
const camera = new OrthographicCamera(-1, 1, 1, -1, 1, CAM_Z + 300);
const keyLight = new DirectionalLight(0xfff0dc, 2.0 / PI); // warm key from the upper left
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 3;
const fillLight = new HemisphereLight(0xfff6e8, 0x2a2119, 1.1 / PI); // sky/ground fill
const ambLight = new AmbientLight(0xbfc8e0, 0.25 / PI);
scene.add(keyLight, keyLight.target, fillLight, ambLight);
const env = new Group();
const fxGroup = new Group();
scene.add(env, fxGroup);

let look: Look | null = null;
let theme: Theme | null = null;
let reducedMotion = false;
/** The playfield in logical px: its top-left in the window and its size; the window's size. */
let view = { x: 0, y: 0, w: 800, h: 600, W: 800, H: 600 };

// -- surfaces -----------------------------------------------------------------------------------
const loader = new TextureLoader();
const textures = new Map<string, Texture | "loading">();
/** A baked texture (assets/textures/<name>.png), or null until it has loaded (the table is rebuilt then). */
function baked(name: string): Texture | null {
  const t = textures.get(name);
  if (t && t !== "loading") return t;
  if (!t) {
    textures.set(name, "loading");
    loader.loadAsync(`assets/textures/${name}.png`).then((tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.anisotropy = 4;
      textures.set(name, tex);
      layoutEnv();
    }, (e: unknown) => console.warn(`texture ${name}: ${String(e)}`));
  }
  return null;
}
let sprite: Texture | null = null;
/** js/render.js spriteTexture: a soft white disc for motes and glowing sparks. */
function spriteTexture(): Texture {
  if (sprite) return sprite;
  const c = new OffscreenCanvas(32, 32);
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  sprite = new CanvasTexture(c);
  return sprite;
}
let envTex: Texture | null = null;
function envMap(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}

interface LitParams {
  color: number | string; map?: Texture | null; bumpMap?: Texture | null; bumpScale?: number; roughness?: number; metalness?: number;
  clearcoat?: number; clearcoatRoughness?: number; envMap?: Texture | null; envMapIntensity?: number;
}
/** js/render.js litMaterial: Lambert on Low, Standard on Balanced, Physical (clear coat) on High/Ultra where asked. */
function litMaterial(p: LitParams, physical = false): Material {
  const kind = look?.budget.material ?? "standard";
  const base = { color: new Color(p.color), map: p.map ?? null };
  if (kind === "lambert") return new MeshLambertMaterial(base);
  const pbr = {
    ...base, bumpMap: p.bumpMap ?? null, bumpScale: p.bumpScale ?? 1, roughness: p.roughness ?? 1, metalness: p.metalness ?? 0,
    envMap: p.envMap ?? null, envMapIntensity: p.envMapIntensity ?? 1,
  };
  if (kind === "physical" && physical) return new MeshPhysicalMaterial({ ...pbr, clearcoat: p.clearcoat ?? 0, clearcoatRoughness: p.clearcoatRoughness ?? 0 });
  return new MeshStandardMaterial(pbr);
}

/** js/render.js layoutEnv: the felt bed, its edge, the frame rails, the inlay and the corner webs, fitted to the playfield. */
function layoutEnv(): void {
  for (const c of [...env.children]) {
    env.remove(c);
    const m = c as Mesh;
    m.geometry?.dispose();
    const mat = m.material as Material | undefined;
    mat?.dispose?.();
  }
  if (!look || !theme) return;
  const th = theme;
  const { w: W, h: H } = view;
  scene.background = new Color(th.sky);
  const detailed = look.detailed;
  const refl = look.reflections;
  const em = refl ? envMap() : null;
  const felt = detailed ? baked(`felt-${th.id}`) : null;
  const woodH = detailed ? baked(`wood-${th.id}-h`) : null;
  const woodV = detailed ? baked(`wood-${th.id}-v`) : null;
  const mk = (w: number, h: number, x: number, y: number, m: Material, z: number, d = 4): Mesh => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), m);
    mesh.position.set(x, -y, z);
    mesh.receiveShadow = true;
    env.add(mesh);
    return mesh;
  };
  const repeat = (t: Texture | null, x: number, y: number): Texture | null => {
    if (!t) return null;
    const c = t.clone();
    c.wrapS = c.wrapT = RepeatWrapping;
    c.repeat.set(x, y);
    return c;
  };
  mk(W + 48, H + 48, W / 2, H / 2, litMaterial({ color: th.feltEdge, roughness: 0.9 }), -8);
  const feltMap = repeat(felt, W / 256, H / 256);
  mk(W, H, W / 2, H / 2, litMaterial({
    color: feltMap ? 0xffffff : th.felt, map: feltMap, bumpMap: feltMap, bumpScale: 0.6, roughness: 0.95, metalness: 0, envMap: em, envMapIntensity: 0.12,
  }), -4);
  const narrow = W < 480;
  const gap = narrow ? 3 : Math.max(6, Math.round(W * 0.008));
  const b = narrow ? 3 : Math.min(10, Math.max(4, gap * 0.75)); // visible lip
  const o = 16; // part hidden outside the view
  const frame = (wood: Texture | null, len: number, vertical: boolean): Material => {
    const map = wood ? repeat(wood, vertical ? 1 : len / 256, vertical ? len / 256 : 1) : null;
    return litMaterial({
      color: map ? 0xffffff : th.frame, map, roughness: 0.6, metalness: 0, clearcoat: detailed ? 0.6 : 0, clearcoatRoughness: 0.25,
      envMap: em, envMapIntensity: 0.45,
    }, true);
  };
  const rails = [
    mk(W + 2 * o, b + o, W / 2, (b - o) / 2, frame(woodH, W + 2 * o, false), -1, 6),
    mk(W + 2 * o, b + o, W / 2, H - (b - o) / 2, frame(woodH, W + 2 * o, false), -1, 6),
    mk(b + o, H, (b - o) / 2, H / 2, frame(woodV, H, true), -1, 6),
    mk(b + o, H, W - (b - o) / 2, H / 2, frame(woodV, H, true), -1, 6),
  ];
  for (const r of rails) r.castShadow = true;
  if (detailed && b >= 6) {
    // Brass-like inlay along the inner edge of the frame.
    const t = 1.5;
    const inlay = (): Material => litMaterial({ color: th.accent, roughness: 0.3, metalness: refl ? 0.75 : 0.2, envMap: em, envMapIntensity: 1 });
    mk(W - 2 * b, t, W / 2, b - t / 2, inlay(), 2.2, 0.6);
    mk(W - 2 * b, t, W / 2, H - b + t / 2, inlay(), 2.2, 0.6);
    mk(t, H - 2 * b, b - t / 2, H / 2, inlay(), 2.2, 0.6);
    mk(t, H - 2 * b, W - b + t / 2, H / 2, inlay(), 2.2, 0.6);
  }
  if (detailed) {
    // Corner webs: spokes and sagging silk rings in the two lower corners,
    // where the columns rarely reach. Faint, so cards always read first.
    const R = Math.min(W, H) * 0.3;
    const pts: number[] = [];
    const push = (x0: number, y0: number, x1: number, y1: number): void => { pts.push(x0, -y0, -1.8, x1, -y1, -1.8); };
    for (const [cx, cy, a0] of [[b, H - b, -PI / 2], [W - b, H - b, PI]] as const) {
      const spokes = 7;
      const ang = (k: number): number => a0 + (k / (spokes - 1)) * (PI / 2);
      for (let k = 0; k < spokes; k++) push(cx, cy, cx + Math.cos(ang(k)) * R, cy + Math.sin(ang(k)) * R);
      for (let ring = 1; ring <= 6; ring++) {
        const rr = (ring / 6.4) * R;
        for (let k = 0; k < spokes - 1; k++) {
          const p0 = [cx + Math.cos(ang(k)) * rr, cy + Math.sin(ang(k)) * rr] as const;
          const p1 = [cx + Math.cos(ang(k + 1)) * rr, cy + Math.sin(ang(k + 1)) * rr] as const;
          // Sag each strand toward the hub (quadratic, 6 segments).
          const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
          const sx = mx + (cx - mx) * 0.12, sy = my + (cy - my) * 0.12;
          let prev: readonly [number, number] = p0;
          for (let s = 1; s <= 6; s++) {
            const t = s / 6, u = 1 - t;
            const p = [u * u * p0[0] + 2 * u * t * sx + t * t * p1[0], u * u * p0[1] + 2 * u * t * sy + t * t * p1[1]] as const;
            push(prev[0], prev[1], p[0], p[1]);
            prev = p;
          }
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    env.add(new LineSegments(geo, new LineBasicMaterial({ color: new Color(th.card), transparent: true, opacity: 0.17, depthWrite: false })));
  }
}

/** js/render.js fitLights: the key light from the upper left of the playfield's centre. */
function fitLights(): void {
  const cx = view.w / 2, cy = -view.h / 2;
  keyLight.target.position.set(cx, cy, 0);
  keyLight.position.set(cx - 0.35 * 150, cy + 0.55 * 150, 150);
  keyLight.shadow.distance = Math.hypot(view.w, view.h) + 400;
}
function frameCamera(): void {
  // The view spans the window: its centre, in the playfield's coordinates.
  camera.top = view.H / 2;
  camera.bottom = -view.H / 2;
  camera.left = -view.W / 2;
  camera.right = view.W / 2;
  camera.position.set(view.W / 2 - view.x, -(view.H / 2 - view.y), CAM_Z);
  camera.lookAt(view.W / 2 - view.x, -(view.H / 2 - view.y), 0);
  camera.updateProjectionMatrix();
}

// -- motes (js/render.js buildMotes / updateMotes) ---------------------------------------------
const motePos = new Float32Array(MOTE_MAX * 3), moteCol = new Float32Array(MOTE_MAX * 3);
const moteData: { x: number; y: number; vx: number; vy: number; ph: number; sp: number }[] = [];
{
  const rnd = createStream("decor:motes");
  for (let i = 0; i < MOTE_MAX; i++) {
    moteData.push({ x: rnd.next(), y: rnd.next(), vx: 3 + rnd.next() * 7, vy: -2 + rnd.next() * 4, ph: rnd.next() * 6.28, sp: 0.6 + rnd.next() * 1.4 });
    motePos[i * 3 + 2] = 14;
  }
}
const moteGeo = new BufferGeometry();
moteGeo.setAttribute("position", new BufferAttribute(motePos, 3));
moteGeo.setAttribute("color", new BufferAttribute(moteCol, 3));
const motes = new Points(moteGeo, new PointsMaterial({
  size: 5, sizeAttenuation: false, map: spriteTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending,
}));
motes.frustumCulled = false;
motes.renderOrder = 4;
scene.add(motes);
let moteT = 0;
function updateMotes(dt: number): void {
  motes.visible = !!look?.animated && !!theme;
  if (!motes.visible) return;
  const { w: W, h: H } = view;
  if (!reducedMotion) moteT += dt;
  const t = moteT;
  const c = new Color(theme!.card);
  const n = Math.min(MOTE_MAX, look!.budget.motes);
  moteGeo.setDrawRange(0, n);
  for (let i = 0; i < n; i++) {
    const m = moteData[i]!;
    const x = ((m.x * W + m.vx * t) % (W + 20) + (W + 20)) % (W + 20) - 10;
    const y = ((m.y * H + m.vy * t + Math.sin(t * 0.4 + m.ph) * 12) % (H + 20) + (H + 20)) % (H + 20) - 10;
    motePos[i * 3] = x; motePos[i * 3 + 1] = -y;
    // Twinkle: mostly dim, brief HDR glints that the bloom pass catches.
    const tw = 0.5 + 0.5 * Math.sin(t * m.sp + m.ph);
    const k = 0.12 + 0.3 * tw + Math.pow(tw, 24) * 2.2;
    moteCol[i * 3] = c.r * k; moteCol[i * 3 + 1] = c.g * k; moteCol[i * 3 + 2] = c.b * k;
  }
  (moteGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
  (moteGeo.getAttribute("color") as BufferAttribute).needsUpdate = true;
}

// -- sparks (js/render.js burst / eventFx), pooled ---------------------------------------------------
interface Spark { mesh: Mesh<MeshBasicMaterial>; vx: number; vy: number; age: number; dur: number; live: boolean }
const sparkGeo = new PlaneGeometry(1, 1);
const sparks: Spark[] = [];
const fxStream = createStream("decor:table");
function liveSparks(): number { let n = 0; for (const s of sparks) if (s.live) n++; return n; }
/** A burst of n sparks at (x, y) in layout px; on the high particle tier glowing additive sprites in HDR colour (bloom lifts them). */
export function burst(x: number, y: number, color: string, n = 12): void {
  if (reducedMotion || !look) return;
  const hi = look.particlesHigh;
  n = Math.min(hi ? Math.round(n * 1.5) : n, look.budget.sparks - liveSparks());
  const c = new Color(color);
  if (hi) c.multiplyScalar(2.4);
  for (let i = 0; i < n; i++) {
    let s = sparks.find((q) => !q.live);
    if (!s) {
      if (sparks.length >= SPARK_MAX) return;
      const mesh = new Mesh(sparkGeo, new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      mesh.renderOrder = 3;
      fxGroup.add(mesh);
      s = { mesh, vx: 0, vy: 0, age: 0, dur: 0, live: false };
      sparks.push(s);
    }
    const a = fxStream.next() * PI * 2;
    const v = 40 + fxStream.next() * 80;
    const m = s.mesh.material;
    m.color.copy(c);
    m.map = hi ? spriteTexture() : null;
    m.blending = hi ? AdditiveBlending : NormalBlending;
    m.opacity = 0.9;
    const size = hi ? 7 + fxStream.next() * 5 : 5;
    s.mesh.scale.set(size, size, 1);
    s.mesh.position.set(x, -y, 20);
    s.mesh.visible = true;
    s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v; s.age = 0; s.dur = hi ? 0.7 : 0.5; s.live = true;
  }
}
/** The fixed step: sparks fly and fade over their authored durations. */
export function tick(dtMs: number): void {
  const dt = dtMs / 1000;
  for (const s of sparks) {
    if (!s.live) continue;
    s.age += dt;
    const t = s.age / s.dur;
    if (t >= 1) { s.live = false; s.mesh.visible = false; continue; }
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y -= s.vy * dt;
    s.mesh.material.opacity = 0.9 * (1 - t);
  }
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface TableLayout { pads: Rect[]; topBar: number }
/** js/render.js eventFx: a burst per rules event, at the column that changed. */
export function eventFx(e: { type: string; col?: number; to?: number }, L: TableLayout | null): void {
  if (!L || !theme) return;
  if (e.type === "run-complete") {
    const r = L.pads[e.col ?? -1];
    if (r) burst(r.x + r.w / 2, r.y + r.h / 2, theme.accent, 24);
  } else if (e.type === "move") {
    const r = L.pads[e.to ?? -1];
    if (r) burst(r.x + r.w / 2, r.y + 10, theme.select, 5);
  } else if (e.type === "deal") {
    burst(view.w / 2, L.topBar / 2, theme.legal, 16);
  } else if (e.type === "win") {
    burst(view.w / 2, view.h / 2, theme.accent, 60);
  }
}
export function clearFx(): void { for (const s of sparks) { s.live = false; s.mesh.visible = false; } }

// -- the game's calls ----------------------------------------------------------------------------
/** The playfield (x, y, w, h) and the window (W, H), in logical px. */
export function setPlayfield(x: number, y: number, w: number, h: number, W: number, H: number): void {
  const next = { x, y, w: Math.max(1, w), h: Math.max(1, h), W: Math.max(1, W), H: Math.max(1, H) };
  const moved = (Object.keys(next) as (keyof typeof next)[]).some((k) => Math.abs(next[k] - view[k]) >= 0.5);
  if (!moved) return;
  const resized = Math.abs(next.w - view.w) >= 0.5 || Math.abs(next.h - view.h) >= 0.5;
  view = next;
  frameCamera();
  fitLights();
  if (resized) layoutEnv();
}
export function setTheme(next: Theme): void {
  if (theme && theme.id === next.id) return;
  theme = next;
  layoutEnv();
}
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
export function setReducedMotion(on: boolean): void { reducedMotion = on; if (on) clearFx(); }
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  keyLight.castShadow = shadows;
  if (shadows) keyLight.shadow.mapSize = next.shadows;
  keyLight.shadow.radius = next.shadows >= 4096 ? 4 : next.shadows >= 2048 ? 3 : 2;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 14, distanceExponent: 1.2, thickness: 12, scale: 1.2, samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // A high threshold: only glints, sparks and highlights bloom (UnrealBloomPass 0.6, 0.45, 0.9).
  renderer.bloom = next.bloom ? { strength: 0.6, radius: 0.45, threshold: 0.9, resolution: next.budget.bloomRes } : null;
  // js/render.js GradeShader (display space): a gentle S-curve, a touch more
  // saturation, warm highlights / cool shadows and the 0.28 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.09, saturation: 1.08,
    shadows: [0.97, 0.98, 1.04], highlights: [1.04, 1.0, 0.95], split: [0.2, 0.8],
    vignette: { amount: 0.28, inner: 0.3, outer: 0.8, scale: [1, 0.9] },
  } : null;
  renderer.antialias = next.antialias;
  layoutEnv();
}
/** Each frame: the motes drift. */
export function update(dt: number): void { updateMotes(Math.min(0.25, Math.max(0, dt))); }
