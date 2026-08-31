// Eight Webs — audio: WebAudio buses (music / effects / ambience / voice),
// procedural transients tied to logical events, seeded pitch variants for
// replay consistency, and caption hooks so no cue is audio-only.

import { createStream } from './rules.js';

// Authored one-shot samples (sfx/<name>.opus), declared in sfx/manifest.json.
// Each logical event prefers its clip; procedural synthesis below runs only
// while the clip is still loading or after a fetch/decode failure.
const SFX_BY_EVENT = {
  'select': 'card-select',
  'deselect': 'card-deselect',
  'move': 'card-move',
  'invalid': 'invalid-move',
  'flip': 'card-flip',
  'deal': 'deal-row',
  'run-complete': 'web-complete',
  'hint': 'hint-chime',
  'undo': 'undo-whoosh',
  'win': 'round-win',
  'lose': 'round-lose',
  'tick': 'clock-tick',
};

export class AudioEngine {
  constructor(settings, captionFn) {
    this.settings = settings;          // live settings object (volume sliders 0..1, muted)
    this.caption = captionFn || (() => {});
    this.ctx = null;
    this.buses = {};
    this.ambienceNodes = null;
    this.musicTimer = null;
    this.stream = createStream('audio:variants'); // cosmetic stream, separate from rules
    this.started = false;
    this.sfx = {};                   // name -> { buffer, loading, failed }
  }

  // Audio contexts must resume from a user gesture; call on first input.
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const master = this.ctx.createGain();
        master.connect(this.ctx.destination);
        this.master = master;
        for (const name of ['music', 'effects', 'ambience', 'voice']) {
          const g = this.ctx.createGain();
          g.connect(master);
          this.buses[name] = g;
        }
        this.applyVolumes();
        this.loadSamples();
      } catch { this.ctx = null; }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    return !!this.ctx;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const v = this.settings;
    const set = (bus, val) => { this.buses[bus].gain.value = v.muted ? 0 : Math.max(0, Math.min(1, val)); };
    set('music', v.volMusic);
    set('effects', v.volEffects);
    set('ambience', v.volAmbience);
    set('voice', v.volVoice);
  }

  suspend() { this.ctx?.suspend().catch(() => {}); }   // background tab policy
  resume() { if (this.started) this.ctx?.resume().catch(() => {}); }

  // Bundled sample assets (assets/audio/*.mp3); synth fallbacks cover failure.
  async loadSamples() {
    this.samples = {};
    const files = { tap: 'assets/audio/sound_tap.mp3', miss: 'assets/audio/sound_miss.mp3', music: 'assets/audio/music_gameplay.mp3' };
    await Promise.all(Object.entries(files).map(async ([k, url]) => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        this.samples[k] = await this.ctx.decodeAudioData(buf);
      } catch { /* procedural fallback covers missing assets */ }
    }));
  }

  playSample(name, bus = 'effects', gain = 0.5) {
    const buf = this.samples?.[name];
    if (!buf || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(this.buses[bus]);
    src.start();
    return true;
  }

  // Lazy-fetch/decode/cache an authored clip for a logical event. Returns true
  // only when the cached buffer was played (through the effects bus, so mute
  // and volume settings apply); otherwise kicks off a one-time load and
  // returns false so the caller falls back to synthesis. No double playback.
  playSfx(eventName) {
    const name = SFX_BY_EVENT[eventName];
    if (!name || !this.ctx) return false;
    const entry = this.sfx[name] ||= { buffer: null, loading: false, failed: false };
    if (entry.failed) return false;
    if (entry.buffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = entry.buffer;
      src.connect(this.buses.effects);
      src.start();
      return true;
    }
    if (!entry.loading) {
      entry.loading = true;
      fetch(`sfx/${name}.opus`)
        .then((r) => { if (!r.ok) throw new Error(`sfx ${name}: HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((raw) => this.ctx ? this.ctx.decodeAudioData(raw) : null)
        .then((buf) => { entry.buffer = buf; entry.failed = !buf; })
        .catch(() => { entry.failed = true; })
        .finally(() => { entry.loading = false; });
    }
    return false;
  }

  // --- procedural transients -------------------------------------------------
  blip(bus, { freq = 440, dur = 0.08, type = 'sine', gain = 0.2, slide = 0 }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.buses[bus]);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  noise(bus, { dur = 0.15, gain = 0.15, freq = 1200 }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (this.stream.next() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(filt); filt.connect(g); g.connect(this.buses[bus]);
    src.start(t);
  }

  // Event hierarchy: input ack < legal move < combo/goal < round completion.
  event(name) {
    const jitter = 1 + (this.stream.next() - 0.5) * 0.08; // seeded variant
    const sfx = this.playSfx(name); // authored clip wins; synth below only while loading/failed
    switch (name) {
      case 'select':   if (!sfx && !this.playSample('tap')) this.blip('effects', { freq: 620 * jitter, dur: 0.05, gain: 0.12 }); this.caption('select'); break;
      case 'deselect': if (!sfx) this.blip('effects', { freq: 420 * jitter, dur: 0.04, gain: 0.08 }); this.caption('cancel'); break;
      case 'move':     if (!sfx) { this.noise('effects', { dur: 0.08, gain: 0.1, freq: 900 }); this.blip('effects', { freq: 340 * jitter, dur: 0.07, gain: 0.14 }); } this.caption('card moved'); break;
      case 'invalid':  if (!sfx && !this.playSample('miss')) this.blip('effects', { freq: 180, dur: 0.12, type: 'square', gain: 0.07 }); this.caption('not a legal move'); break;
      case 'flip':     if (!sfx) this.noise('effects', { dur: 0.05, gain: 0.12, freq: 2400 }); this.caption('card revealed'); break;
      case 'deal':     if (!sfx) { this.noise('effects', { dur: 0.2, gain: 0.14, freq: 1400 }); this.blip('effects', { freq: 500, dur: 0.1, gain: 0.1, slide: 200 }); } this.caption('dealt a row'); break;
      case 'run-complete':
        if (!sfx) {
          this.blip('effects', { freq: 523, dur: 0.12, gain: 0.16 });
          setTimeout(() => this.blip('effects', { freq: 659, dur: 0.12, gain: 0.16 }), 90);
          setTimeout(() => this.blip('effects', { freq: 784, dur: 0.2, gain: 0.18 }), 180);
        }
        this.caption('web complete!'); break;
      case 'hint':     if (!sfx) this.blip('effects', { freq: 740 * jitter, dur: 0.09, gain: 0.1 }); this.caption('hint shown'); break;
      case 'undo':     if (!sfx) this.blip('effects', { freq: 300, dur: 0.08, gain: 0.1, slide: -120 }); this.caption('move undone'); break;
      case 'win':
        if (!sfx) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip('effects', { freq: f, dur: 0.25, gain: 0.18 }), i * 140));
        this.caption('round won'); break;
      case 'lose':     if (!sfx) this.blip('effects', { freq: 220, dur: 0.4, gain: 0.12, slide: -80 }); this.caption('round over'); break;
      case 'tick':     if (!sfx) this.blip('effects', { freq: 880, dur: 0.03, gain: 0.05 }); break;
    }
  }

  // --- ambience: quiet filtered noise bed ------------------------------------
  startAmbience() {
    if (!this.ensure() || this.ambienceNodes) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.98 + (this.stream.next() * 2 - 1) * 0.02; d[i] = last * 8; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 400;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(filt); filt.connect(g); g.connect(this.buses.ambience);
    src.start();
    this.ambienceNodes = { src, g };
  }

  stopAmbience() {
    try { this.ambienceNodes?.src.stop(); } catch {}
    this.ambienceNodes = null;
  }

  // --- adaptive music: slow pentatonic plucks, denser as webs complete --------
  startMusic(getIntensity) {
    if (this.musicTimer || !this.ensure()) return;
    // Bundled music bed (looped) under the adaptive procedural stems.
    const bed = this.samples?.music;
    if (bed && !this.musicBed) {
      const src = this.ctx.createBufferSource();
      src.buffer = bed; src.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0.35;
      src.connect(g); g.connect(this.buses.music);
      src.start();
      this.musicBed = { src, g };
    }
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
    const beat = () => {
      const intensity = getIntensity?.() ?? 0; // 0..1 from game progress
      if (this.stream.next() < 0.45 + intensity * 0.45) {
        const f = this.stream.pick(scale) * (this.stream.next() < 0.2 ? 2 : 1);
        this.blip('music', { freq: f, dur: 0.6, type: 'triangle', gain: 0.05 + intensity * 0.03 });
      }
      this.musicTimer = setTimeout(beat, 1400 - intensity * 600);
    };
    beat();
  }

  stopMusic() {
    clearTimeout(this.musicTimer); this.musicTimer = null;
    try { this.musicBed?.src.stop(); } catch {}
    this.musicBed = null;
  }

  dispose() {
    this.stopMusic(); this.stopAmbience();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.sfx = {}; // buffers belong to the closed context
  }
}
