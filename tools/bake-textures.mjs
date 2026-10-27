// Bakes the table's procedural surface textures into assets/textures/ once
// (offline; the engine loads them as images): the felt fibres per theme
// (felt-<theme>.png, 256²) and the frame's wood grain per theme, along the
// rails (wood-<theme>-h.png, 256×64) and turned for the side rails
// (wood-<theme>-v.png, 64×256). The drawing is the browser build's
// js/render.js feltTexture / woodTexture, seeded from the same decor streams
// (js/rules.js createStream), run in Chrome's canvas: the engine's canvas
// rasterizes thousands of strokes too slowly at start-up.
//   node tools/bake-textures.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(root, 'package.json'))('playwright-core');
const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { THEMES } = await import('../js/content.js');
const rules = readFileSync(join(root, 'js/rules.js'), 'utf8');
const stream = rules.slice(rules.indexOf('export function hashSeed'), rules.indexOf('export function card('))
  .replace(/export /g, '');

const { browser, close } = await launchChrome(chromium);
const page = await browser.newPage();
const out = await page.evaluate(({ src, themes }) => {
  const createStream = new Function(`${src}; return createStream;`)();
  const res = {};
  for (const theme of themes) {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = theme.felt; g.fillRect(0, 0, S, S);
    const rnd = createStream('decor:felt');
    for (let i = 0; i < 2600; i++) {
      const x = rnd.next() * S, y = rnd.next() * S;
      const a = rnd.next() * Math.PI, l = 2 + rnd.next() * 5;
      const light = rnd.next() < 0.5;
      g.strokeStyle = light ? `rgba(255,245,225,${0.015 + rnd.next() * 0.03})` : `rgba(0,0,0,${0.05 + rnd.next() * 0.08})`;
      g.lineWidth = 0.7;
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
      }
    }
    res[`felt-${theme.id}`] = cv.toDataURL('image/png');
    const base = document.createElement('canvas');
    base.width = 256; base.height = 64;
    const w = base.getContext('2d');
    w.fillStyle = theme.frame; w.fillRect(0, 0, 256, 64);
    const wr = createStream('decor:wood');
    for (let i = 0; i < 70; i++) {
      const y0 = wr.next() * 64, amp = 1 + wr.next() * 3, f = 1 + Math.floor(wr.next() * 3);
      const dark = wr.next() < 0.6;
      w.strokeStyle = dark ? `rgba(40,22,10,${0.08 + wr.next() * 0.14})` : `rgba(255,230,190,${0.05 + wr.next() * 0.08})`;
      w.lineWidth = 0.6 + wr.next() * 1.4;
      w.beginPath();
      for (let x = 0; x <= 256; x += 4) {
        const y = y0 + Math.sin((x / 256) * Math.PI * 2 * f + i) * amp;
        if (x === 0) w.moveTo(x, y); else w.lineTo(x, y);
      }
      w.stroke();
    }
    res[`wood-${theme.id}-h`] = base.toDataURL('image/png');
    const v = document.createElement('canvas');
    v.width = 64; v.height = 256;
    const vg = v.getContext('2d');
    vg.translate(64, 0); vg.rotate(Math.PI / 2); vg.drawImage(base, 0, 0);
    res[`wood-${theme.id}-v`] = v.toDataURL('image/png');
  }
  return res;
}, { src: stream, themes: THEMES });
await close();
mkdirSync(join(root, 'assets/textures'), { recursive: true });
for (const [name, url] of Object.entries(out)) {
  writeFileSync(join(root, 'assets/textures', `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`assets/textures/${name}.png`);
}
