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
 * test embeds a minimal static file server (ephemeral port) instead. The game
 * probes /api/v1/time to detect a hosted backend; served 404 here, so the
 * platform runs in its documented offline local mode — the resulting
 * "Failed to load resource ... 404" console entries for /api/v1/* are
 * expected and filtered as benign.
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
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Benign GPU/swiftshader noise (same regex as tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

const step = async (name, fn) => { await fn(); console.log(`ok - ${name}`); };

async function playthrough(ctxOpts, tag, maxHintMoves) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (browserNoise.test(text)) return;
    // Offline-mode probe of the (absent) StarHermit backend: expected 404s.
    if (text.includes('Failed to load resource') && (m.location()?.url || '').includes('/api/v1/')) return;
    errors.push(`console: ${text}`);
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
  console.log('\nE2E PASS — both viewport passes clean, no page errors');
} finally {
  await browser.close();
  server.close();
}
