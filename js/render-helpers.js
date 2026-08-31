// Small shared helpers for the render layer, kept dependency-light so
// rules.js stays pure (no render-only imports leaking into the engine).
export { createStream, rankLabel } from './rules.js';
export const SUITS_FALLBACK = null;
