// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways: Play, Learn and lesson 1's Start, then
// the lesson's two moves — by the card cursor's keys on the desktop; on the
// phones the 2 dragged onto the long run and the Ace moved by two taps — to
// its results. Fails on console errors or warnings or the runtime's error
// screen.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it. playwright-core is
// resolved from GAME_DIR's node_modules or any sibling game's.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] ?? '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  // The platform's clock (platform.serverTime / serverNow), as the game host answers it.
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
// Lesson 1 (Build Down): column 2's 2 onto column 3's long run, then column 1's Ace onto it. The card
// centres are js/layout.js computeLayout's for each view's playfield (between the top bar and the tray).
const desktop = [['shot', 'title'], ['key', 'Enter'], ['wait', 1500], ['shot', 'modes'], ['key', 'Enter'], ['wait', 1500], ['key', 'Enter'], ['wait', 2500], ['shot', 'lesson'],
  ['key', 'ArrowDown'], ['key', 'ArrowRight'], ['key', 'Enter'], ['shot', 'lifted'], ['key', 'ArrowRight'], ['key', 'Enter'], ['wait', 1500],
  ['key', 'ArrowLeft'], ['key', 'Enter'], ['key', 'ArrowRight'], ['key', 'ArrowRight'], ['key', 'Enter'], ['wait', 3000], ['shot', 'results']];
// Phones: Play, the Learn card and the first Start by taps (fractions of the viewport), the drag and the taps on the cards.
const phone = (play, learn, start, two, run, ace) => [['shot', 'title'], ['tap', ...play], ['wait', 1500], ['shot', 'modes'], ['tap', ...learn], ['wait', 1500], ['shot', 'lessons'],
  ['tap', ...start], ['wait', 2500], ['shot', 'lesson'], ['drag', ...two, ...run], ['wait', 1500], ['shot', 'dragged'], ['tap', ...ace], ['wait', 800], ['shot', 'lifted'], ['tap', ...run], ['wait', 3000], ['shot', 'results']];
const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, steps: desktop },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    steps: phone([0.5, 0.57], [0.5, 0.25], [0.16, 0.227], [59.5 / 390, 201 / 844], [98.2 / 390, 184 / 844], [20.8 / 390, 201 / 844]) },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    steps: phone([0.5, 0.42], [0.3, 0.35], [0.176, 0.51], [109 / 844, 150 / 390], [179 / 844, 116 / 390], [38.6 / 844, 150 / 390]) },
];
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(3000);
  await page.mouse.click(4, 4);
  await page.waitForTimeout(1500);
  for (const [op, a, b, ...rest] of v.steps) {
    if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(120); await page.keyboard.up(a); }
    if (op === 'down') await page.keyboard.down(a);
    if (op === 'up') await page.keyboard.up(a);
    if (op === 'press') { await page.mouse.move(v.viewport.width * a, v.viewport.height * b); await page.mouse.down(); }
    if (op === 'lift') await page.mouse.up();
    if (op === 'tap') await page.touchscreen.tap(v.viewport.width * a, v.viewport.height * b);
    if (op === 'drag') {
      const [x0, y0, x1, y1] = [a * v.viewport.width, b * v.viewport.height, rest[0] * v.viewport.width, rest[1] * v.viewport.height];
      await page.mouse.move(x0, y0); await page.mouse.down();
      for (let k = 1; k <= 8; k++) { await page.mouse.move(x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); await page.waitForTimeout(40); }
      await page.mouse.up();
    }
    if (op === 'wait') { await page.waitForTimeout(a); continue; }
    if (op === 'shot' && shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${a}.png`) }); }
    await page.waitForTimeout(2000);
  }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
