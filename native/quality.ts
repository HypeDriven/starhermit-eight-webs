// The look per graphics level. The engine-owned effects come from the
// frame's level (levelSettings()): shadows on/off and the key light's map
// size (the game sets it; since minor 23 the runtime keeps a game's
// mapSize), ambient occlusion (resolution and samples), bloom resolution,
// the grade and anti-aliasing (anisotropy is left at 4: the camera looks
// straight down on the table). The game's own art is the browser build's
// four presets and budgets (js/gfx.js TABLE / BUDGETS, each tuned to hold 60
// FPS on the weakest GPU its Auto gave it), keyed by the runtime's quality
// tier (frame().quality); the silk motes and the spark cap scale with the
// level's particle budget over the tier's anchor level (at most 4×). The
// runtime owns the rest of what the old Graphics panel did: Auto and the
// level choice, render scale and the pixel-ratio cap, adaptive resolution,
// the frame-rate limit and readout, and the MSAA samples. The per-category
// overrides of the old panel are not offered (the runtime's Options choose
// a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lit materials: Lambert, standard PBR, or physical (clear-coated frame). */
  material: "lambert" | "standard" | "physical";
  /** Live spark sprites across bursts; drifting silk motes drawn. */
  sparks: number;
  motes: number;
}
export interface Look {
  preset: Preset;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  /** The level's ambient occlusion (null = off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
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

type Art = Pick<Look, "reflections" | "particlesHigh" | "animated" | "detailed">;
const ART: Record<Preset, Art> = {
  low: { reflections: false, particlesHigh: false, animated: false, detailed: false },
  balanced: { reflections: true, particlesHigh: true, animated: true, detailed: true },
  high: { reflections: true, particlesHigh: true, animated: true, detailed: true },
  ultra: { reflections: true, particlesHigh: true, animated: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", sparks: 40, motes: 16 },
  balanced: { material: "standard", sparks: 90, motes: 32 },
  high: { material: "physical", sparks: 240, motes: 64 },
  ultra: { material: "physical", sparks: 400, motes: 96 },
};
/** js/gfx.js POOLS and PARTICLE_BUDGET: the most sparks and motes ever drawn. */
export const SPARK_MAX = 600;
export const MOTE_MAX = 256;
const PARTICLE_CAP = { low: 120, high: 600 };
/** Each tier's first level: its budgets are tuned there. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a level's settings (the frame's level by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const row = ART[preset];
  const b = { ...BUDGETS[preset] };
  // The level's particle budget over the tier's anchor: motes and sparks
  // grow with the level above the tier's first, at most 4× the tier's budget.
  const k = Math.min(4, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.sparks = Math.min(SPARK_MAX, PARTICLE_CAP[row.particlesHigh ? "high" : "low"], Math.round(b.sparks * k));
  return {
    preset, ...row, budget: b,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
  };
}
