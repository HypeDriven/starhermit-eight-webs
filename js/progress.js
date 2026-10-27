// Eight Webs — the save's pure parts, shared by the engine client
// (native/platform.ts) and the node tests: the progress document (the
// browser build's shape, unchanged), the browser build's cloud save read as
// that document, and the game options kept in the account's settings with
// the browser build's settings keys they are migrated from.

/** A fresh progress document (ui.js's default). */
export function freshProgress() {
  return { v: 1, journey: {}, lessonsDone: {}, achievements: {}, websCleared: 0, daysPlayed: [], bests: {}, mastery: {} };
}

/** A stored document as progress (missing fields filled), or null when it is not a v1 progress document. */
export function asProgress(doc) {
  if (!doc || typeof doc !== 'object' || doc.v !== 1) return null;
  return { ...freshProgress(), ...doc, v: 1 };
}

/** The browser build's cloud save (the JS SDK's saveJSON text of the progress document), or null. */
export function readForeign(text) {
  if (!text) return null;
  try { return asProgress(JSON.parse(text)); } catch { return null; }
}

export const THEME_IDS = ['shadowbox', 'midnight', 'jade', 'porcelain', 'ember'];
export const CVD_IDS = ['none', 'deuter', 'protan', 'tritan'];
/** The game's options (ui.js DEFAULT_SETTINGS less what the runtime's Options now own). */
export const OPTION_DEFAULTS = { theme: 'shadowbox', cvd: 'none', leftHanded: false, holdToDrag: false, haptics: true };

/** A stored option value, or undefined when it is not one. */
export function checkOption(key, v) {
  if (key === 'theme') return typeof v === 'string' && THEME_IDS.includes(v) ? v : undefined;
  if (key === 'cvd') return typeof v === 'string' && CVD_IDS.includes(v) ? v : undefined;
  if (key in OPTION_DEFAULTS) return typeof v === 'boolean' ? v : undefined;
  return undefined;
}

// The browser build's account settings: its settings document mirrored key by
// key (ui.js saveSettings → patchSettings), the language helper's ui.language
// and the options panel's audio.options / graphics.gpu.<profile> slots.
export const BROWSER_KEYS = [
  'theme', 'graphics', 'muted', 'volMusic', 'volEffects', 'volAmbience', 'volVoice', 'reducedMotion', 'highContrast', 'largeText',
  'leftHanded', 'holdToDrag', 'haptics', 'cvd', 'cameraPreset', 'tier', 'ui.language', 'audio.options',
];
/** Whether a legacy settings key is the browser build's (removed once migrated). */
export function isBrowserKey(k) { return BROWSER_KEYS.includes(k) || String(k).startsWith('graphics.gpu.'); }
