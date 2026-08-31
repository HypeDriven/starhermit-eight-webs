// Eight Webs — bootstrap: capability detection, host handshake, asset order,
// module wiring, and app lifecycle. Loaded as the only module entry point.

import { Platform } from './platform.js';
import { Session } from './session.js';
import { UI } from './ui.js';
import { TableRenderer } from './render.js';
import { AudioEngine } from './audio.js';
import { getTheme } from './content.js';

async function boot() {
  const root = document.getElementById('app');
  const platform = new Platform();

  // Host handshake: read scope from the launch token; sync the server clock so
  // countdowns and daily boundaries follow platform time.
  platform.syncServerTime();

  let ui = null;
  const audio = new AudioEngine(
    new Proxy({}, { get: (_, k) => ui?.settings?.[k] }),
    (text) => ui?.caption(text),
  );
  const session = new Session(platform, (e) => ui?.onEvent(e));
  const renderer = new TableRenderer(null, () => getTheme(ui?.settings?.theme), () => ui?.settings || {});

  ui = new UI(root, session, platform, renderer, audio);

  // The renderer mounts into the playfield the UI shell just built.
  renderer.container = document.getElementById('playfield');
  const glOk = renderer.init();
  renderer.setSuits(ui.suits);
  if (!glOk) {
    const note = document.createElement('p');
    note.className = 'compat-note';
    note.textContent = '3D view unavailable on this device — the accessible table below is fully playable.';
    renderer.container.prepend(note);
  }

  // Audio lifecycle: start ambience + music on first gesture, pause when hidden.
  const kickAudio = () => {
    if (!audio.started) {
      audio.started = true;
      audio.ensure();
      audio.startAmbience();
      audio.startMusic(() => {
        const st = session.state;
        return st ? st.foundations / Math.max(1, st.webGoal) : 0;
      });
    }
  };
  window.addEventListener('pointerdown', kickAudio, { once: true });
  window.addEventListener('keydown', kickAudio, { once: true });

  ui.show('title');
  platform.telemetry('start');

  // Debug handle for smoke tests.
  window.__eightwebs = { session, ui, renderer, platform };
}

boot().catch((e) => {
  document.getElementById('app').innerHTML =
    `<div class="wrap"><h1>Eight Webs</h1><p>Failed to start: ${e.message}</p></div>`;
});
