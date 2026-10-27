// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the silk motes and the spark cap scaled within the tier by the level
// (frame().levelIndex), as the browser build scaled them by its hardware
// level (at most 4×, never below the tier's floor). The runtime owns the rest
// of what the old Graphics panel did: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout, and the shadow-map size and MSAA samples it holds to the level.
// The per-category overrides of the old panel are not offered (the runtime's
// Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lit materials: Lambert, standard PBR, or physical (clear-coated frame). */
  material: "lambert" | "standard" | "physical";
  /** Live spark sprites across bursts; drifting silk motes drawn. */
  sparks: number;
  motes: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: Preset;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based lighting from the room on the frame, felt and inlay. */
  reflections: boolean;
  /** Glowing additive sparks (more per burst) instead of small squares. */
  particlesHigh: boolean;
  /** Drifting, glinting silk motes. */
  animated: boolean;
  /** Felt and wood textures, the brass inlay, the corner webs and the cards' finish. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "off", reflections: false, particlesHigh: false, animated: false, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particlesHigh: true, animated: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particlesHigh: true, animated: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particlesHigh: true, animated: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", sparks: 40, motes: 16, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", sparks: 90, motes: 32, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", sparks: 240, motes: 64, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", sparks: 400, motes: 96, bloomRes: 1, aoRes: 1 },
};
/** js/gfx.js POOLS and PARTICLE_BUDGET: the most sparks and motes ever drawn. */
export const SPARK_MAX = 600;
export const MOTE_MAX = 256;
const PARTICLE_CAP = { low: 120, high: 600 };
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const row = TABLE[preset];
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: motes and sparks grow
  // with the level above the tier's first, at most 4× the tier's budget.
  const k = Math.min(4, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.sparks = Math.min(SPARK_MAX, PARTICLE_CAP[row.particlesHigh ? "high" : "low"], Math.round(b.sparks * k));
  return { preset, ...row, budget: b };
}
