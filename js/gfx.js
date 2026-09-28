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
  balanced: { scale: 1, cap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  high: { scale: 1, cap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra: { scale: 1.25, cap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_BUDGET = { low: 120, high: 600 };

/**
 * Best preset for this GPU, from the WEBGL_debug_renderer_info unmasked
 * renderer string. Software renderers get Low, discrete GPUs / Apple M get
 * High, everything else Balanced. Touch/mobile devices are capped at Balanced.
 */
export function detectPreset(gpu, opts = {}) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  if (opts.mobile && PRESETS.indexOf(p) > PRESETS.indexOf('balanced')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 * `ctx.contextMsaa`: the WebGL context was created with antialias (MSAA can
 * then run without the composer).
 */
export function resolve(saved, detected, ctx = {}) {
  const s = saved || {};
  const preset = PRESETS.includes(s.preset) ? s.preset : (PRESETS.includes(detected) ? detected : 'balanced');
  const row = TABLE[preset];
  const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto: !PRESETS.includes(s.preset), renderScale, scale: row.scale * renderScale, cap: row.cap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
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
export function describe(r, pixels) {
  const parts = [
    r.shadows === 'off' ? 'no shadows' : `${SHADOW_MAP[r.shadows]}² shadows`,
    r.ao === 'off' ? null : r.ao === 'high' ? 'full AO' : 'AO',
    r.bloom === 'on' ? 'bloom' : null,
    r.reflections === 'on' ? 'reflections' : null,
    r.antialias === 'off' ? 'no AA' : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
