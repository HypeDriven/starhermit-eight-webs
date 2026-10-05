/**
 * Eight Webs — end-to-end QA playthrough (dev only, not shipped).
 * Run: npm run test:e2e
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Learn lesson 1 (scripted, deterministic win → results modal)
 *   → Journey stage 1 (keyboard deal, hint-driven card clicks, undo, hint,
 *     pause/resume, settings toggles, give-up → results modal) → title.
 * Game state (window.__eightwebs.session) is read only to decide WHICH
 * visible element to click next; every action goes through real UI input.
 *
 * The repo's server.js is the StarHermit authoritative game server, so this
 * test embeds a minimal static file server (ephemeral port) instead.
 * Standalone (no launch token) the game must make zero same-origin /api or
 * /ws requests — each standalone pass asserts it. The signed-in pass stubs
 * the platform API and GET /api/v1/time (allowed only with a token).
 *
 * Two passes: desktop 1280x800, then a fresh context at mobile 390x844
 * (hasTouch). Any non-benign pageerror/console error fails the run.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, tag) => `/tmp/eight-webs-e2e-${stage}-${tag}.png`;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ts': 'video/mp2t',
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
// PORT pins the embedded static server (default: ephemeral); BASE_URL targets an already running server instead.
if (!process.env.BASE_URL) await new Promise((r) => server.listen(Number(process.env.PORT) || 0, '127.0.0.1', r));
const BASE = process.env.BASE_URL || `http://127.0.0.1:${server.address().port}`;

// Benign GPU/swiftshader noise (same regex as tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

const step = async (name, fn) => { await fn(); console.log(`ok - ${name}`); };

// StarHermit routes (the game's own /api/v1 time/score/leaderboard are separate).
const PLATFORM_API = /^\/api\/v1\/(games|users|me|leaderboards|chat)\//;
// Any own-server route: forbidden in a standalone load.
const OWN_SERVER = /^\/(api|ws)(\/|$)/;

// Signed-in pass: launch token in the fragment, platform API stubbed.
async function platformPass(ctxOpts, tag) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], seen = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (browserNoise.test(text)) return;
    errors.push(`console ${m.type()}: ${text}`);
  });
  await page.route((url) => url.pathname === '/api/v1/time', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ now: Date.now() }) }));
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-e2e-0001', game_scope: 'eight-webs', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  await page.route((url) => PLATFORM_API.test(url.pathname), (route) => {
    const req = route.request(), u = new URL(req.url());
    seen.push(req.method() + ' ' + u.pathname);
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.endsWith('/profile')) return json({ nickname: 'Pip Tester' });
    if (u.pathname.endsWith('/settings') && req.method() === 'GET') return json({ settings: { highContrast: true } });
    if (u.pathname.endsWith('/controls')) return json({ actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    return route.fulfill({ status: 204 });
  });
  const click = (loc) => (ctxOpts.hasTouch ? loc.tap() : loc.click());
  try {
    await step(`[${tag}] signed in: nickname, save load, fragment stripped`, async () => {
      await page.goto(`${BASE}/#game_token=${jwt}`, { waitUntil: 'load' });
      await page.waitForFunction(() => /Pip Tester/.test(document.querySelector('.title-platform')?.textContent || ''), null, { timeout: 8000 });
      if (await page.evaluate(() => location.hash)) throw new Error('launch fragment not stripped');
      if (await page.locator('.btn-signin').count()) throw new Error('sign-in shown while signed in');
      if (!seen.includes('GET /api/v1/me/cloud-saves/' + encodeURIComponent('game:eight-webs'))) throw new Error('no cloud load: ' + seen.join(', '));
    });
    await step(`[${tag}] platform settings applied (high contrast)`, async () => {
      await page.waitForFunction(() => window.__eightwebs?.ui?.settings?.highContrast === true, null, { timeout: 5000 });
    });
    await step(`[${tag}] invite a friend shows a confirmation toast`, async () => {
      const btn = page.locator('.btn-invite');
      await btn.scrollIntoViewIfNeeded();
      await click(btn);
      await page.waitForSelector('.toast', { timeout: 3000 });
      const box = await page.locator('.toast').first().boundingBox();
      const vw = page.viewportSize().width;
      if (!box || box.x < 0 || box.x + box.width > vw + 1) throw new Error('toast off-screen ' + JSON.stringify(box));
      await page.screenshot({ path: SHOT('platform', tag) });
    });
    await step(`[${tag}] help lists the platform key binding`, async () => {
      const help = page.getByRole('button', { name: 'Help' }).first();
      await help.scrollIntoViewIfNeeded();
      await click(help);
      await page.waitForFunction(() => /J hints/.test(document.body.textContent), null, { timeout: 3000 });
    });
  } finally {
    await context.close();
  }
  if (errors.length) throw new Error(`[${tag}] page errors:\n${errors.join('\n')}`);
}

async function playthrough(ctxOpts, tag, maxHintMoves) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin && OWN_SERVER.test(u.pathname)) errors.push('standalone made an own-server call: ' + r.url());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (browserNoise.test(text)) return;
    errors.push(`console ${m.type()}: ${text}`);
  });

  // Click a card by column/index. Non-top cards are covered by the card below
  // except for their top strip, so click near the element's top edge.
  const clickCard = async (col, idx) => {
    await page.locator(`[data-col="${col}"][data-idx="${idx}"]`).click({ position: { x: 10, y: 3 } });
  };
  const waitNoToast = async () => {
    const toast = page.locator('.toast');
    if (await toast.count()) await toast.waitFor({ state: 'detached', timeout: 8000 });
  };
  const stateInfo = () => page.evaluate(() => {
    const s = window.__eightwebs?.session;
    return s?.state ? {
      machine: s.machine, status: s.state.status, moves: s.state.moves,
      deals: s.state.dealsUsed, foundations: s.state.foundations,
    } : null;
  });

  try {
    await step(`[${tag}] load + title screen`, async () => {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('.title-screen');
      const h1 = await page.textContent('.title-screen h1');
      if (!h1?.includes('Eight Webs')) throw new Error(`unexpected title: ${h1}`);
      await page.screenshot({ path: SHOT('title', tag) });
    });

    await step(`[${tag}] Settings → Graphics: presets, override, persistence`, async () => {
      const bodyPreset = () => page.evaluate(() => document.body.dataset.gfxPreset);
      const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('eightwebs:settings') || '{}').graphics || {});
      const openSettings = async () => {
        await page.getByRole('button', { name: 'Settings' }).click();
        await page.locator('#gfx-section').scrollIntoViewIfNeeded();
      };
      // Headless Chrome renders on SwiftShader: Auto resolves to Low.
      if (await bodyPreset() !== 'low') throw new Error(`auto preset under SwiftShader: ${await bodyPreset()}`);
      await openSettings();
      const autoLabel = await page.locator('#gfx-preset option[value="auto"]').textContent();
      if (!/Auto \(detected: Low\)/.test(autoLabel)) throw new Error(`auto label: ${autoLabel}`);
      await page.locator('#gfx-preset').selectOption('low');
      if (await bodyPreset() !== 'low' || (await saved()).preset !== 'low') throw new Error('Low not applied');
      await page.locator('#gfx-preset').selectOption('ultra');
      await page.waitForTimeout(600); // a few frames through the full Ultra chain
      if (await bodyPreset() !== 'ultra') throw new Error('Ultra not applied');
      await page.locator('#gfx-preset').selectOption('high');
      if (await bodyPreset() !== 'high') throw new Error('High not applied');
      if (!(await page.locator('#gfx-bloom option[value="preset"]').textContent()).includes('(On)')) throw new Error('bloom preset label');
      await page.locator('#gfx-bloom').selectOption('off');
      await page.waitForFunction(() => !/bloom/.test(document.querySelector('#gfx-summary').textContent));
      if ((await saved()).bloom !== 'off') throw new Error('bloom override not saved');
      if (!(await page.locator('.shell').getAttribute('class')).includes('gfx-detailed')) throw new Error('High should use detailed surfaces');
      await page.screenshot({ path: SHOT('graphics', tag) });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.title-screen');
      if (await bodyPreset() !== 'high') throw new Error('preset did not survive reload');
      await openSettings();
      if (await page.locator('#gfx-preset').inputValue() !== 'high') throw new Error('preset select after reload');
      if (await page.locator('#gfx-bloom').inputValue() !== 'off') throw new Error('override after reload');
      // Back to Auto: choosing a preset clears overrides.
      await page.locator('#gfx-preset').selectOption('auto');
      if (await page.locator('#gfx-bloom').inputValue() !== 'preset') throw new Error('preset change kept override');
      if (await bodyPreset() !== 'low') throw new Error('Auto not restored');
      await page.getByRole('button', { name: 'Close' }).click();
      await page.waitForSelector('.modal', { state: 'detached' });
    });

    await step(`[${tag}] Learn screen → lesson 1 starts`, async () => {
      await page.getByRole('button', { name: 'Learn' }).first().click();
      await page.waitForSelector('.menu-screen h1');
      const cards = await page.locator('.menu-list .setup-card').count();
      if (cards !== 5) throw new Error(`expected 5 lessons, got ${cards}`);
      await page.locator('.menu-list .setup-card').first().getByRole('button', { name: 'Start' }).click();
      await page.waitForFunction(() => window.__eightwebs?.session.machine === 'tutorial');
      await waitNoToast();
      await page.screenshot({ path: SHOT('lesson', tag) });
    });

    await step(`[${tag}] lesson 1: play the two taught moves to a win`, async () => {
      // Step 1: move the 2 (col 1) onto the 3 at the foot of col 2.
      await clickCard(1, 0);
      await clickCard(2, 10); // foot card of the K..3 run (11 cards)
      await waitNoToast();
      // Step 2: set the Ace (col 0) on the 2 — completes King..Ace web.
      await clickCard(0, 0);
      await clickCard(2, 11); // foot is now the 2 (12 cards)
      await page.waitForFunction(() => {
        const h2 = document.querySelector('.modal h2');
        return h2 && h2.textContent.includes('All webs cleared');
      });
      const rows = await page.locator('.modal .score-breakdown dt').count();
      if (rows < 5) throw new Error(`expected score breakdown rows, got ${rows}`);
      await page.screenshot({ path: SHOT('lesson-win', tag) });
      const st = await stateInfo();
      if (st.status !== 'won' || st.foundations !== 1) throw new Error('lesson not won: ' + JSON.stringify(st));
      await page.getByRole('button', { name: 'Title' }).click();
      await page.waitForSelector('.title-screen');
      const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('eightwebs:progress')));
      if (!prog?.lessonsDone?.['learn-1']) throw new Error('lesson completion not persisted');
    });

    await step(`[${tag}] journey screen: 40 stages, stage 1 unlocked`, async () => {
      await page.getByRole('button', { name: 'Journey' }).first().click();
      await page.waitForSelector('.menu-screen h1');
      const cards = page.locator('.menu-list .setup-card');
      if (await cards.count() !== 40) throw new Error('expected 40 journey stages');
      if (!(await cards.nth(1).locator('.btn-primary').isDisabled())) throw new Error('stage 2 should be locked');
      await page.screenshot({ path: SHOT('journey', tag) });
    });

    await step(`[${tag}] journey stage 1: countdown → active`, async () => {
      await page.locator('.menu-list .setup-card').first().getByRole('button', { name: 'Start' }).click();
      await page.waitForFunction(() => window.__eightwebs?.session.machine === 'active', null, { timeout: 9000 });
      const visible = await page.locator('.bottom-tray .btn-primary').isVisible();
      if (!visible) throw new Error('deal button not visible in play');
      await page.screenshot({ path: SHOT('play', tag) });
    });

    await step(`[${tag}] keyboard deal + hint-driven moves through the board UI`, async () => {
      await page.keyboard.press('d'); // deal one row (no empty columns at start)
      await page.waitForFunction(() => window.__eightwebs.session.state.dealsUsed === 1);
      const before = (await stateInfo()).moves;
      let made = 0;
      for (let i = 0; i < maxHintMoves; i++) {
        const hint = await page.evaluate(() => {
          const s = window.__eightwebs.session;
          if (!s?.state || s.state.status !== 'active') return null;
          const h = s.hint(); // read-only decision aid; the move itself is clicked below
          if (!h) return { none: true };
          return { from: h.from, idx: h.idx, to: h.to, destLen: s.state.cols[h.to].length };
        });
        if (!hint) break; // round ended on its own
        if (hint.none) break;
        await clickCard(hint.from, hint.idx);
        if (hint.destLen > 0) await clickCard(hint.to, hint.destLen - 1);
        else await page.locator(`.col-pad[aria-label="Column ${hint.to + 1} (empty)"]`).click();
        made += 1;
      }
      const after = (await stateInfo()).moves;
      console.log(`  moves made: ${made} (counter ${before} → ${after})`);
      if (after - before !== made || made < 3) throw new Error(`moves did not register: made=${made}, counter=${after - before}`);
    });

    await step(`[${tag}] hint + undo buttons`, async () => {
      await page.getByRole('button', { name: 'Hint', exact: true }).click();
      await page.waitForSelector('.card.hinted');
      const before = (await stateInfo()).moves;
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      const after = (await stateInfo()).moves;
      if (after !== before - 1) throw new Error(`undo did not revert a move (${before} → ${after})`);
    });

    await step(`[${tag}] pause → snapshot → settings → resume`, async () => {
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal h2');
      if ((await page.textContent('.modal h2')) !== 'Paused') throw new Error('pause modal missing');
      const snap = await page.evaluate(() => JSON.parse(localStorage.getItem('eightwebs:autosave') || 'null'));
      if (!snap) throw new Error('autosave snapshot not written on pause');
      // exercise settings inside the pause modal
      await page.locator('.setting-row', { hasText: 'Reduced motion' }).locator('input').check();
      await page.locator('.setting-row', { hasText: 'Theme' }).locator('select').selectOption('midnight');
      const applied = await page.evaluate(() => ({
        motion: document.querySelector('.shell').classList.contains('reduced-motion'),
        paper: document.querySelector('.shell').style.getPropertyValue('--paper'),
      }));
      if (!applied.motion) throw new Error('reduced-motion not applied');
      await page.locator('.setting-row', { hasText: 'Reduced motion' }).locator('input').uncheck();
      await page.locator('.setting-row', { hasText: 'Theme' }).locator('select').selectOption('shadowbox');
      await page.screenshot({ path: SHOT('pause', tag) });
      await page.getByRole('button', { name: 'Resume' }).click();
      await page.waitForFunction(() => window.__eightwebs.session.machine === 'active');
    });

    await step(`[${tag}] give up → results modal → title`, async () => {
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal h2');
      await page.getByRole('button', { name: 'Give up' }).click();
      await page.waitForFunction(() => {
        const h2 = document.querySelector('.modal h2');
        return h2 && h2.textContent === 'Round abandoned';
      });
      const rows = await page.locator('.modal .score-breakdown dt').count();
      if (rows < 5) throw new Error('results breakdown missing');
      await page.screenshot({ path: SHOT('results', tag) });
      await page.getByRole('button', { name: 'Title' }).click();
      await page.waitForSelector('.title-screen');
    });
  } finally {
    await context.close();
  }
  if (errors.length) {
    throw new Error(`[${tag}] page errors:\n${errors.join('\n')}`);
  }
}

try {
  await playthrough({ viewport: { width: 1280, height: 800 } }, 'desktop', 12);
  await playthrough({ viewport: { width: 390, height: 844 }, hasTouch: true }, 'mobile', 6);
  await platformPass({ viewport: { width: 1280, height: 800 } }, 'platform-desktop');
  await platformPass({ viewport: { width: 390, height: 844 }, hasTouch: true }, 'platform-mobile');
  console.log('\nE2E PASS — both viewport passes clean, no page errors');
} finally {
  await browser.close();
  if (server.listening) server.close();
}
