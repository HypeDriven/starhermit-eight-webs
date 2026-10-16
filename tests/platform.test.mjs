// Eight Webs — StarHermit adapter unit tests (node --test).
// Loads starhermit-sdk.js (classic script) and the js/platform.js module
// against a stubbed window, fetch and launch hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SDK_SRC = readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
const SLUG = 'eight-webs';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-12345678', game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
// Clear the SDK's renewal timer so the test process can exit.
test.afterEach(() => { globalThis.StarHermit?.signOut(); });

async function boot(hash) {
  const calls = [];
  const store = { save: null, settings: {}, version: 0, etag: null };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, init });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/v1/users/u-12345678/profile')) return json({ nickname: 'Pip' });
    if (url.includes('/api/v1/me/cloud-saves/')) {
      // Conditional writes: the SDK sends If-Match with the ETag it last saw;
      // a newer save from "another device" (store.etag bumped) answers 412.
      if (url.endsWith('/info')) return json({ exists: !!store.save, etag: store.etag });
      if (method === 'PUT') {
        const ifMatch = init.headers && init.headers['If-Match'];
        if (ifMatch && ifMatch !== store.etag) return json({ error: 'precondition_failed', etag: store.etag }, 412);
        store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        store.etag = '"v' + (++store.version) + '"';
        return json({ etag: store.etag });
      }
      return store.save ? new Response(store.save, { status: 200 }) : new Response('', { status: 404 });
    }
    if (url.endsWith(`/api/v1/games/${SLUG}/settings`)) {
      if (method === 'PATCH') Object.assign(store.settings, JSON.parse(init.body).settings);
      return json({ settings: store.settings });
    }
    if (url.endsWith(`/api/v1/games/${SLUG}/controls`)) return json({ actions: [{ action: 'hint', codes: ['F2'] }] });
    if (url === '/api/v1/time') return json({ now: Date.now() });
    return new Response('', { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname: 'localhost', href: 'http://localhost/' + hash, origin: 'http://localhost' };
  globalThis.window = {
    location,
    history: { state: null, replaceState(_s, _t, url) { const i = url.indexOf('#'); location.hash = i >= 0 ? url.slice(i) : ''; } },
    addEventListener() {},
  };
  globalThis.document = { hidden: false, addEventListener() {} };
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };

  vm.runInThisContext(SDK_SRC);               // defines globalThis.StarHermit
  window.StarHermit = globalThis.StarHermit;
  const { Platform } = await import('../js/platform.js');
  return { P: new Platform(), calls, store };
}

test('launch token: read from the fragment, stripped, slug from claims', async () => {
  const { P } = await boot('#game_token=' + JWT + '&session_id=s1');
  assert.equal(P.tokenHosted, true);
  assert.equal(P.slug, SLUG);
  assert.equal(P.userId, 'u-12345678');
  assert.equal(window.location.hash, '');
  assert.equal(P.token, JWT);
  assert.equal(P.identityId, 'u-12345678');
});

test('a lost cloud write (412) is reported as a save conflict and cleared by a reload', async () => {
  const { P, store } = await boot('#game_token=' + JWT);
  let conflicts = 0;
  P.onSaveConflict(() => conflicts++);
  assert.equal(await P.loadCloudSave(), null);
  P.saveLocal('eightwebs:progress', { v: 1, websCleared: 1 });
  assert.equal(await P.flushSave(true), true);
  store.etag = '"elsewhere"'; // another device saved since
  P.saveLocal('eightwebs:progress', { v: 1, websCleared: 2 });
  assert.equal(await P.flushSave(true), false);
  assert.equal(conflicts, 1);
  assert.equal(P.saveConflicted(), true);
  await P.loadCloudSave();
  assert.equal(P.saveConflicted(), false);
  P.saveLocal('eightwebs:progress', { v: 1, websCleared: 3 });
  assert.equal(await P.flushSave(true), true, 'the reload unblocks writes');
});

test('mergeProgress keeps the better side of every record', async () => {
  const { mergeProgress } = await import('../js/session.js');
  const m = mergeProgress(
    { v: 1, journey: { 'journey-1': { score: 900, at: 1 }, 'journey-2': { score: 100, at: 1 } }, lessonsDone: { 'learn-1': true },
      achievements: { first_web: 5 }, websCleared: 12, daysPlayed: ['2026-10-01'], bests: { a: 10 }, mastery: { m1: true } },
    { v: 1, journey: { 'journey-2': { score: 300, at: 2 }, 'journey-3': { score: 50, at: 2 } }, lessonsDone: { 'learn-2': true },
      achievements: { first_web: 9, streak_5: 3 }, websCleared: 8, daysPlayed: ['2026-10-02'], bests: { a: 5, b: 7 }, mastery: {} });
  assert.deepEqual(Object.keys(m.journey).sort(), ['journey-1', 'journey-2', 'journey-3']);
  assert.equal(m.journey['journey-2'].score, 300);
  assert.deepEqual(Object.keys(m.lessonsDone).sort(), ['learn-1', 'learn-2']);
  assert.deepEqual(m.achievements, { first_web: 5, streak_5: 3 });
  assert.equal(m.websCleared, 12);
  assert.deepEqual(m.daysPlayed, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(m.bests, { a: 10, b: 7 });
  assert.deepEqual(m.mastery, { m1: true });
});

test('profile name comes from the profile nickname', async () => {
  const { P } = await boot('#game_token=' + JWT);
  await P.init();
  assert.deepEqual(await P.fetchProfile(), { name: 'Pip' });
  assert.equal(P.displayName, 'Pip');
});

test('cloud save round-trips through /api/v1/me/cloud-saves/game:<slug>', async () => {
  const { P, calls } = await boot('#game_token=' + JWT);
  const doc = { v: 1, journey: {}, websCleared: 3 };
  P.saveLocal('eightwebs:progress', doc);
  assert.equal(P.sync, 'saving');
  assert.equal(await P.flushSave(true), true);
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG)), put.url);
  assert.equal(put.init.keepalive, true);
  assert.equal(P.sync, 'synced');
  assert.equal(await P.loadCloudSave(), JSON.stringify(doc));
});

test('settings patch, bindings, invite link and own-server time', async () => {
  const { P, calls, store } = await boot('#game_token=' + JWT);
  await P.init();
  const time = calls.find((c) => c.url === '/api/v1/time');
  assert.equal(time.init.headers.Authorization, 'Bearer ' + JWT);
  await Promise.all([P.patchSettings({ volMusic: 0.2 }), P.patchSettings({ muted: true })]);
  assert.deepEqual(store.settings, { volMusic: 0.2, muted: true });
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1, 'patches are debounced into one');
  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'], undo: ['KeyU'] }), { hint: ['F2'], undo: ['KeyU'] });
  assert.match(P.inviteLink(), /game-invite\/u-12345678\/eight-webs$/);
});

test('standalone: no StarHermit calls without a token', async () => {
  const { P, calls } = await boot('');
  await P.init();
  assert.equal(P.tokenHosted, false);
  assert.equal(P.canSignIn(), false);
  assert.equal(P.inviteLink(), null);
  assert.equal(await P.fetchProfile(), null);
  assert.equal(await P.loadCloudSave(), null);
  P.saveLocal('eightwebs:progress', { v: 1 });
  await P.flushSave(true);
  await P.patchSettings({ a: 1 });
  assert.deepEqual(await P.getSettings(), {});
  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  // no own-server calls either: standalone uses the local clock
  assert.deepEqual(calls.map((c) => c.url), []);
  assert.equal(P.serverOffsetMs(), 0);
});
