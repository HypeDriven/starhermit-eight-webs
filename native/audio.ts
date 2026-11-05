// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.txt) per game event, the study's room-tone
// loop (sfx/ambience-study.opus) and the music bed (assets/audio/
// music_gameplay.mp3, re-encoded as sfx/music-gameplay.opus: the engine
// decodes WAV, Vorbis and Opus) looping from the first press, with the
// adaptive pentatonic plucks over it (denser and louder as webs clear), and
// a caption for every cue so no cue is audio-only.
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes and the mute): music → "music", the effects and the ambience
// → "effects" (voice carried nothing); the old default bus levels (music
// 60 %, effects 80 %, ambience 40 %) are folded into each sound's gain. The
// plucks' triangle notes are rendered once into clips (createClip) with the
// old oscillator envelope; the synthesized stand-ins the browser build
// played while a clip decoded (and its tap / miss mp3 samples) are not
// ported (a live synthesis graph makes clip loads fail on the engine's web
// runtime; the arrow-exodus port's finding), so a clip still loading is
// silent. Every clip loads at once in onStart (the engine hands each loaded
// clip to the mixer, natively and on the web); the loops and the plucks
// start once the mixer runs (in a browser, after the first press).
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { createStream } from "../js/rules.js";

const LEVEL = { music: 0.6, effects: 0.8, ambience: 0.4 };
export type Cue =
  | "select" | "deselect" | "move" | "invalid" | "flip" | "deal" | "run-complete" | "hint" | "undo" | "win" | "lose"
  | "tick" | "time-warning" | "achievement" | "lesson-step" | "pause";
const SAMPLES: Record<Cue, string> = {
  select: "card-select", deselect: "card-deselect", move: "card-move", invalid: "invalid-move", flip: "card-flip",
  deal: "deal-row", "run-complete": "web-complete", hint: "hint-chime", undo: "undo-whoosh", win: "round-win",
  lose: "round-lose", tick: "clock-tick", "time-warning": "clock-warning", achievement: "achievement-unlock",
  "lesson-step": "lesson-step", pause: "pause-open",
};
/** js/audio.js event(): the caption each cue shows (translated where it is drawn). */
export const CAPTIONS: Partial<Record<Cue, string>> = {
  select: "select", deselect: "cancel", move: "card moved", invalid: "not a legal move", flip: "card revealed",
  deal: "dealt a row", "run-complete": "web complete!", hint: "hint shown", undo: "move undone", win: "round won",
  lose: "round over", "time-warning": "one minute left", achievement: "achievement unlocked", "lesson-step": "next lesson step",
  pause: "paused",
};
const AMBIENCE = "ambience-study";
const MUSIC = "music-gameplay";

const clips = new Map<string, AudioClip>();
let suspended = false;
let captionHook: ((text: string) => void) | null = null;
/** fn(text) for each cue's caption (the UI shows it for 1.6 s). */
export function onCaption(fn: (text: string) => void): void { captionHook = fn; }

/** Loads every clip at once (onStart); a cue whose clip is still loading is silent. */
export function loadSfx(): void {
  for (const name of new Set([AMBIENCE, MUSIC, ...Object.values(SAMPLES)])) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
}

/** Plays a cue's sample (once loaded) and shows its caption. */
export function cue(name: Cue): void {
  const caption = CAPTIONS[name];
  if (caption) captionHook?.(caption);
  const file = SAMPLES[name];
  const clip = clips.get(file);
  if (!clip || suspended) return;
  try { playClip(clip, { bus: "effects", gain: LEVEL.effects }); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the beds and the adaptive plucks ----------------------------------------------------------
const RATE = 22050;
/** js/audio.js blip('music', { type: 'triangle', dur: 0.6 }): a triangle with an exponential decay to 0.0001 over 0.6 s. */
function pluckClip(freq: number): AudioClip {
  const dur = 0.6;
  const n = Math.round((dur + 0.02) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const ph = (t * freq) % 1;
    const tri = 1 - 4 * Math.abs(ph - 0.5);
    out[i] = tri * Math.pow(0.0001, Math.min(1, t / dur));
  }
  return createClip([out], RATE);
}
const SCALE = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
const plucks = new Map<number, AudioClip>();
const stream = createStream("audio:variants");
let ambience: Sound | null = null;
let bed: Sound | null = null;
let nextBeat = 0;
let nextRender = 0;
let intensity: () => number = () => 0;
/** The music's intensity 0–1 (webs cleared of the goal), read at each beat. */
export function setIntensity(fn: () => number): void { intensity = fn; }
/** A hidden window: the beds and plucks hold (js/audio.js suspend). */
export function setSuspended(on: boolean): void {
  suspended = on;
  if (on) {
    for (const s of [ambience, bed]) { try { s?.stop(); } catch { /* gone */ } }
    ambience = bed = null;
  }
}

/** Each frame once the mixer runs: the two loops (in separate frames), the pluck notes rendered one each 0.3 s,
 * then the plucks' beats by mixer time. */
export function update(): void {
  if (context.state !== "running" || suspended) return;
  try {
    const amb = clips.get(AMBIENCE), mus = clips.get(MUSIC);
    if (amb && !ambience) { ambience = playClip(amb, { bus: "effects", gain: 0.6 * LEVEL.ambience, loop: true }); return; }
    if (mus && !bed && ambience) { bed = playClip(mus, { bus: "music", gain: 0.35 * LEVEL.music, loop: true }); return; }
    if (context.currentTime >= nextRender && plucks.size < SCALE.length * 2) {
      const i = plucks.size;
      plucks.set(i, pluckClip(SCALE[i % SCALE.length]! * (i >= SCALE.length ? 2 : 1)));
      nextRender = context.currentTime + 0.3;
      return;
    }
  } catch (e) { console.warn(`audio: ${String(e)}`); return; }
  if (plucks.size < SCALE.length * 2) return;
  const now = context.currentTime;
  if (now < nextBeat) return;
  const k = Math.max(0, Math.min(1, intensity()));
  if (stream.next() < 0.45 + k * 0.45) {
    const note = stream.int(0, SCALE.length - 1) + (stream.next() < 0.2 ? SCALE.length : 0);
    const clip = plucks.get(note);
    try { if (clip) playClip(clip, { bus: "music", gain: (0.05 + k * 0.03) * LEVEL.music }); } catch { /* the mixer is full */ }
  }
  nextBeat = Math.max(now, nextBeat) + (1400 - k * 600) / 1000;
}
