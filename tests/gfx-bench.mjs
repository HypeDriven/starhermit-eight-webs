// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Journey stage 1 and keeps playing the session's hinted moves by clicking the cards and empty
// column pads (card flights, sparks, silk motes, the felt/frame scene and the post chain all run),
// dealing a row with D when no move is left and restarting the stage when the round ends.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.getByRole('button', { name: 'Settings' }).click({ timeout: 20000 });
  await page.locator('#gfx-section').scrollIntoViewIfNeeded();
  await page.locator('#gfx-preset').selectOption(preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.getByRole('button', { name: 'Close' }).click();
}

async function startStage(page) {
  await page.getByRole('button', { name: 'Journey' }).first().click();
  await page.locator('.menu-list .setup-card').first().getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(() => window.__eightwebs?.session.machine === 'active', null, { timeout: 9000 });
}

async function move(page) {
  const hint = await page.evaluate(() => {
    const s = window.__eightwebs?.session;
    if (!s?.state) return { idle: true };
    if (s.state.status !== 'active') return { over: true };
    const h = s.hint(); // read-only decision aid; the move itself is clicked below
    if (!h) return { deal: true };
    return { from: h.from, idx: h.idx, to: h.to, destLen: s.state.cols[h.to].length };
  });
  if (hint.idle) return;
  if (hint.over) {
    await page.keyboard.press('Escape').catch(() => {});
    const title = page.getByRole('button', { name: 'Title' });
    if (await title.count()) { await title.first().click(); await startStage(page); }
    return;
  }
  if (hint.deal) { await page.keyboard.press('d'); return; }
  await page.locator(`[data-col="${hint.from}"][data-idx="${hint.idx}"]`).click({ position: { x: 10, y: 3 }, timeout: 2000 });
  if (hint.destLen > 0) await page.locator(`[data-col="${hint.to}"][data-idx="${hint.destLen - 1}"]`).click({ position: { x: 10, y: 3 }, timeout: 2000 });
  else await page.locator(`.col-pad[aria-label="Column ${hint.to + 1} (empty)"]`).click({ timeout: 2000 });
}

export async function start(page) {
  await startStage(page);
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await move(page); } catch { if (!open) return; }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  await page.waitForTimeout(800);
}
