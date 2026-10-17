// Eight Webs — graphics quality model: presets, per-category overrides, GPU
// detection and a cost summary. Pure (no three.js, no DOM), so the settings
// panel, the renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],   // RoomEnvironment IBL on frame and cards
  particles: ['low', 'high'],   // burst budget + glowing silk sparks
  background: ['static', 'animated'], // drifting silk motes + light shimmer
  detail: ['plain', 'detailed'], // felt/wood textures + DOM card finish
};

// Each preset: a row of tiers, a render scale and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 1, cap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'off', reflections: 'off', particles: 'low', background: 'static', detail: 'plain' },
  balanced: { scale: 0.9, cap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  high: { scale: 1, cap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra: { scale: 1.25, cap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_BUDGET = { low: 120, high: 600 };

// Auto picks the preset from the StarHermit hardware level (gpu-level.js → globalThis.StarHermitGpu,
// loaded before the game modules): 0 = Galaxy S20 / Intel UHD or weaker and every software renderer,
// 20 = RTX 5090, each level ≈ 1.23×. Low from 0, Balanced from 4, High from 10, Ultra from 17. Phones,
// tablets and ≤ 4 GB machines are capped at level 9 (Balanced) by the shared module.
export const PRESET_LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level (0–20) for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system = {}) {
  const G = gpuApi();
  if (!G) return PRESET_LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...system, gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, PRESET_LEVELS);
  return level >= 17 ? 'ultra' : level >= 10 ? 'high' : level >= 4 ? 'balanced' : 'low';
}

/** Best preset for this GPU (the level already caps phones and tablets at Balanced). */
export function detectPreset(gpu, system = {}) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Counts are tuned at
 * the preset's floor level and scale up within the preset on faster GPUs (StarHermitGpu.scaleBudget, ≤ 4×).
 *   material   'lambert' | 'standard' | 'physical' (felt, edge, frame, inlay, cards; frame clearcoat on Physical);
 *   cardTex    card-face canvas scale (×128×180 px);
 *   sparks     live spark sprites across bursts (the Particles tier caps them: low 120, high 600);
 *   motes      drifting silk motes (Scenery motion; pool 64·4);
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame.
 */
export const BUDGETS = {
  low: { material: 'lambert', cardTex: 1, sparks: 40, motes: 16, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', cardTex: 1, sparks: 90, motes: 32, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', cardTex: 1.5, sparks: 240, motes: 64, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', cardTex: 2, sparks: 400, motes: 96, bloomRes: 1, aoRes: 1 },
};
const POOLS = { sparks: 600, motes: 256 };

/** A preset's concrete budget for a hardware level (counts scale up within the preset, never down). */
export function budgetFor(preset, level = 0) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const floor = PRESET_LEVELS[preset] || 0;
  const G = gpuApi();
  for (const k of Object.keys(POOLS)) {
    b[k] = Math.min(POOLS[k], Math.round(G ? G.scaleBudget(b[k], Math.max(Number(level) || 0, floor), floor) : b[k]));
  }
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 * `ctx.contextMsaa`: the WebGL context was created with antialias (MSAA can
 * then run without the composer).
 */
export function resolve(saved, detected, ctx = {}, level = 0) {
  const s = saved || {};
  const preset = PRESETS.includes(s.preset) ? s.preset : (PRESETS.includes(detected) ? detected : 'balanced');
  const row = TABLE[preset];
  const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto: !PRESETS.includes(s.preset), renderScale, scale: row.scale * renderScale, cap: row.cap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.budget = budgetFor(preset, level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // The composer runs only when something needs it; otherwise the scene is
  // drawn straight to the canvas (Low stays as cheap as a plain render).
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on'
    || out.antialias === 'fxaa' || out.antialias === 'smaa'
    || (out.antialias === 'msaa' && !ctx.contextMsaa);
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  if (cat === 'scale' || cat === 'cap') return TABLE[preset]?.[cat];
  return CATEGORIES[cat] ? TABLE[preset]?.[cat] : undefined;
}

/** Choosing a preset clears every per-category override (scale and toggles stay). */
export function choosePreset(saved, preset) {
  const out = {};
  for (const k of ['render_scale', 'adaptive', 'show_fps']) if (saved && k in saved) out[k] = saved[k];
  out.preset = PRESETS.includes(preset) ? preset : 'auto';
  return out;
}

/** Short English cost summary (the panel localizes its own labels around it). */
// tr(key, vars) localizes the parts (the UI passes i18n T; default English).
const plain = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v && v[k] != null ? v[k] : ''));
export function describe(r, pixels, tr = plain) {
  const parts = [
    r.shadows === 'off' ? tr('no shadows') : tr('{size}² shadows', { size: SHADOW_MAP[r.shadows] }),
    r.ao === 'off' ? null : r.ao === 'high' ? tr('full AO') : tr('AO'),
    r.bloom === 'on' ? tr('bloom') : null,
    r.reflections === 'on' ? tr('reflections') : null,
    r.antialias === 'off' ? tr('no AA') : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
