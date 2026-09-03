// Eight Webs — authoritative server.
// Node 20+, dependency-free (node:http only, so a clean checkout runs it
// without npm install). Serves the static distribution plus:
//   - StarHermit host API: GET /api/v1/time, score submission with
//     deterministic replay validation, leaderboards, achievement delivery.
//   - Session/state API (see docs chapter 8): /api/session, /api/settings,
//     /api/game/start|state|action|stop with restart-persistent storage.
// Start: node server.js   (PORT env overrides the default 3000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { createGame, applyCommand, hashState, replay, compareResults, serialize, deserialize } from './js/rules.js';
import { dailyForDate, validateContent, ACHIEVEMENTS, CONTENT_VERSION } from './js/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.EIGHT_WEBS_DATA || path.join(__dirname, '.server-data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const BUILD = '1.0.0';

// ---------------------------------------------------------------------------
// Durable store (survives restarts)
// ---------------------------------------------------------------------------

const store = { sessions: {}, games: {}, boards: {}, achievements: {}, exclusions: {} };
function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.assign(store, raw);
  } catch { /* first boot */ }
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(store));
    } catch (e) { console.error('persist failed:', e.message); }
  }, 50);
}
loadStore();

// ---------------------------------------------------------------------------
// Rate limiting (recoverable 429, per spec: structured {"error": ...})
// ---------------------------------------------------------------------------

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n += 1;
  return b.n <= max;
}

// ---------------------------------------------------------------------------
// Minimal HTTP plumbing (replaces express)
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

const ok = (res, extra = {}) => sendJson(res, 200, { ok: true, ...extra });
const fail = (res, code, message, status = 400) =>
  sendJson(res, status, { ok: false, error: message, error_code: code, message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; } // payload size bound
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Malformed JSON body')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.normalize(path.join(__dirname, rel));
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) return false;
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const idx = path.join(filePath, 'index.html');
      stat = fs.statSync(idx);
      if (!stat.isFile()) return false;
      return streamFile(req, res, idx, stat);
    }
  } catch { return false; }
  return streamFile(req, res, filePath, stat);
}

function streamFile(req, res, filePath, stat) {
  // Immutable hashed assets cache long; everything else revalidates.
  const cache = /node_modules|assets/.test(filePath) ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Each handler receives (req, res, params, body). `params` holds the named
// segments from patterns like '/api/v1/daily/session/:id'.
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler });
}

function getSession(id) {
  const s = store.sessions[id];
  return s || null;
}
function gameView(g) {
  if (!g) return null;
  return {
    phase: g.phase, level_index: g.level_index, lives_remaining: g.lives_remaining,
    score: g.score, combo_count: g.combo_count, web_progress: g.web_progress,
  };
}

// --- StarHermit platform time (round-trip-adjusted by the client) -----------
route('GET', '/api/v1/time', (req, res) => {
  ok(res, { now: Date.now(), utcDay: new Date().toISOString().slice(0, 10), build: BUILD });
});

// Daily content descriptor for the current UTC day (immutable seed).
route('GET', '/api/v1/daily', (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  if (store.exclusions[day]) return fail(res, 'day-excluded', 'This daily is excluded from ranking', 409);
  const def = dailyForDate(new Date());
  ok(res, { day, content: { id: def.id, seed: def.seed, suits: def.suits, limits: def.limits, par: def.par, contentV: def.v, rulesV: def.rulesV, assists: def.assists } });
});

// --- Daily session: authoritative script for seeded daily rounds ------------
// POST /api/v1/daily/start  { } -> { sessionId, content, state }
route('POST', '/api/v1/daily/start', (req, res) => {
  const key = req.socket.remoteAddress || 'anon';
  if (!rateLimit(`start:${key}`, 30, 60000)) return fail(res, 'rate-limited', 'Too many requests; retry shortly', 429);
  const day = new Date().toISOString().slice(0, 10);
  if (store.exclusions[day]) return fail(res, 'day-excluded', 'This daily is excluded from ranking', 409);
  const def = dailyForDate(new Date());
  const state = createGame(def);
  const sessionId = crypto.randomUUID();
  store.games[sessionId] = {
    kind: 'daily', day, contentId: def.id, seed: def.seed, suits: def.suits,
    limits: def.limits, par: def.par, assists: def.assists,
    contentV: def.v, rulesV: def.rulesV,
    state: JSON.parse(serialize(state)), commands: [],
    createdAt: Date.now(), lastSeen: Date.now(), done: false,
  };
  persist();
  ok(res, { sessionId, content: { id: def.id, seed: def.seed, suits: def.suits, limits: def.limits, par: def.par, assists: def.assists }, snapshot: store.games[sessionId].state });
});

// POST /api/v1/daily/command { sessionId, command } — validated, idempotent.
route('POST', '/api/v1/daily/command', (req, res, params, body) => {
  const { sessionId, command } = body || {};
  const g = store.games[sessionId];
  if (!g || g.kind !== 'daily') return fail(res, 'unknown-session', 'No such daily session', 404);
  if (g.done) return fail(res, 'round-over', 'Session already finished');
  if (!rateLimit(`cmd:${sessionId}`, 240, 60000)) return fail(res, 'rate-limited', 'Command rate exceeded', 429);
  // Idempotent duplicate rejection happens inside applyCommand via cmd id.
  const prev = deserialize(JSON.stringify(g.state));
  const r = applyCommand(prev, command);
  if (r.error) {
    if (r.error === 'duplicate-command') return ok(res, { duplicate: true, hash: hashState(prev) });
    return fail(res, 'illegal-command', r.error);
  }
  g.state = JSON.parse(serialize(r.state));
  g.commands.push(command);
  g.lastSeen = Date.now();
  if (r.state.status !== 'active') g.done = true;
  persist();
  ok(res, { events: r.events || [], hash: hashState(r.state), status: r.state.status, state: g.state });
});

// GET /api/v1/daily/session/:id — fresh snapshot for reconnecting clients.
route('GET', '/api/v1/daily/session/:id', (req, res, params) => {
  const g = store.games[params.id];
  if (!g) return fail(res, 'unknown-session', 'No such session', 404);
  ok(res, {
    snapshot: g.state, done: g.done, day: g.day,
    away: { lastSeen: g.lastSeen, commands: g.commands.length },
  });
});

// --- Score submission with replay validation --------------------------------
// POST /api/v1/score { board, envelope } — envelope replayed server-side.
route('POST', '/api/v1/score', (req, res, params, body) => {
  const { board, envelope } = body || {};
  if (!board || !envelope) return fail(res, 'bad-request', 'board and envelope required');
  if (!rateLimit(`score:${req.socket.remoteAddress}`, 20, 60000)) return fail(res, 'rate-limited', 'Too many submissions', 429);
  if (envelope.build > CONTENT_VERSION + 1) return fail(res, 'stale-version', 'Unknown content version');
  const r = replay(envelope);
  if (!r.ok) return fail(res, 'replay-invalid', `Replay rejected: ${r.error} at command ${r.atCommand}`);
  const claimed = envelope.result;
  const final = r.final;
  if (!claimed || claimed.score?.total !== final.score.total || claimed.status !== final.status) {
    return fail(res, 'score-mismatch', 'Claimed result does not match validated replay');
  }
  // Plausibility: elapsed time must cover the command count at human speed.
  if (final.elapsedMs < final.moves * 150) return fail(res, 'implausible', 'Impossible play speed');
  if (envelope.contentId?.startsWith('daily-')) {
    const day = envelope.contentId.slice(6);
    if (store.exclusions[day]) return fail(res, 'day-excluded', 'Day excluded from ranking');
  }
  const entry = {
    score: final.score.total, status: final.status, foundations: final.foundations,
    moves: final.moves, invalid: final.invalid, elapsedMs: final.elapsedMs,
    seed: envelope.seed, contentId: envelope.contentId, contentV: envelope.contentV,
    assists: envelope.init?.assists ?? null, sessionId: claimed.sessionId,
    undos: final.undos, at: Date.now(), validated: true,
  };
  const list = (store.boards[board] ||= []);
  list.push(entry);
  list.sort((x, y) => compareResults(
    { status: x.status, foundations: x.foundations, score: { total: x.score }, invalid: x.invalid, elapsedMs: x.elapsedMs, sessionId: x.sessionId },
    { status: y.status, foundations: y.foundations, score: { total: y.score }, invalid: y.invalid, elapsedMs: y.elapsedMs, sessionId: y.sessionId },
  ));
  store.boards[board] = list.slice(0, 100);
  persist();
  const rank = store.boards[board].findIndex((e) => e.sessionId === entry.sessionId && e.at === entry.at) + 1;
  ok(res, { rank, score: entry.score, validated: true });
});

// GET /api/v1/leaderboard/:board?scope=global|friends
route('GET', '/api/v1/leaderboard/:board', (req, res, params) => {
  const list = (store.boards[params.board] || []).slice(0, 20).map((e, i) => ({
    rank: i + 1, score: e.score, status: e.status, foundations: e.foundations,
    moves: e.moves, invalid: e.invalid, elapsedMs: e.elapsedMs,
    seed: e.seed, contentId: e.contentId, assists: e.assists, validated: e.validated,
  }));
  ok(res, { board: params.board, entries: list, label: 'validated' });
});

// --- Achievements: durable, idempotent delivery -----------------------------
route('POST', '/api/v1/achievements', (req, res, params, body) => {
  const { playerId, keys } = body || {};
  if (!playerId || !Array.isArray(keys)) return fail(res, 'bad-request', 'playerId and keys[] required');
  const known = new Set(ACHIEVEMENTS.map((a) => a.key));
  const owned = (store.achievements[playerId] ||= {});
  const unlocked = [];
  for (const k of keys) {
    if (!known.has(k)) continue;          // undeclared keys rejected silently
    if (!owned[k]) { owned[k] = Date.now(); unlocked.push(k); } // idempotent
  }
  persist();
  ok(res, { unlocked, owned: Object.keys(owned) });
});

route('GET', '/api/v1/achievements/:playerId', (req, res, params) => {
  ok(res, { owned: Object.keys(store.achievements[params.playerId] || {}) });
});

// ---------------------------------------------------------------------------
// Session/state API (docs chapter 8) — POST /api/... JSON, {ok:true|false,...}
// ---------------------------------------------------------------------------

route('POST', '/api/session', (req, res) => {
  const id = crypto.randomUUID();
  store.sessions[id] = {
    created_at_ms: Date.now(),
    settings: { sound_enabled: true, music_enabled: true, haptics_enabled: true },
    game_id: null,
  };
  persist();
  ok(res, { session_id: id, created_at_ms: store.sessions[id].created_at_ms, settings: store.sessions[id].settings });
});

route('POST', '/api/settings', (req, res, params, body) => {
  const s = getSession(body?.session_id) || Object.values(store.sessions).at(-1);
  if (!s) return fail(res, 'no-session', 'Create a session first');
  const b = body || {};
  const keys = ['sound_enabled', 'music_enabled', 'haptics_enabled'];
  const given = keys.filter((k) => typeof b[k] === 'boolean');
  if (!given.length) return fail(res, 'bad-request', 'At least one boolean setting is required');
  for (const k of given) s.settings[k] = b[k];
  persist();
  ok(res, { settings: s.settings });
});

route('POST', '/api/game/start', (req, res, params, body) => {
  const s = getSession(body?.session_id) || Object.values(store.sessions).at(-1);
  if (!s) return fail(res, 'no-session', 'Create a session first');
  const id = crypto.randomUUID();
  // A new game replaces any in-progress one (docs 8.4).
  store.games[id] = {
    kind: 'tap', phase: 'playing', level_index: 0, lives_remaining: 3,
    score: 0, combo_count: 0, web_progress: [0, 0, 0, 0, 0, 0, 0, 0],
    started_at_ms: Date.now(),
  };
  s.game_id = id;
  persist();
  ok(res, { game_id: id, started_at_ms: store.games[id].started_at_ms, initial_state: gameView(store.games[id]) });
});

function withGame(req, res, body, fn) {
  const s = getSession(body?.session_id) || Object.values(store.sessions).at(-1);
  if (!s || !s.game_id || !store.games[s.game_id]) return fail(res, 'no-game', 'No game in progress', 404);
  const g = store.games[s.game_id];
  fn(g);
  persist();
  ok(res, { state: gameView(g) });
}

route('POST', '/api/game/state', (req, res, params, body) => withGame(req, res, body, () => {}));

route('POST', '/api/game/action', (req, res, params, body) => {
  const t = body?.action_type;
  if (!['tap', 'pause', 'resume'].includes(t)) return fail(res, 'bad-request', 'action_type must be tap|pause|resume');
  withGame(req, res, body, (g) => {
    if (t === 'pause' && g.phase === 'playing') g.phase = 'paused';
    else if (t === 'resume' && g.phase === 'paused') g.phase = 'playing';
    else if (t === 'tap' && g.phase === 'playing') {
      const idx = g.web_progress.findIndex((p) => p < 100);
      const hit = idx >= 0 && ((g.score + g.combo_count) % 3 !== 2); // deterministic rule
      if (hit) {
        g.combo_count += 1;
        g.score += 10 + g.combo_count * 2;
        g.web_progress[idx] = Math.min(100, g.web_progress[idx] + 10);
        if (g.web_progress[idx] >= 100) g.level_index += 1;
        if (g.web_progress.every((p) => p >= 100)) g.phase = 'won';
      } else {
        g.combo_count = 0;
        g.lives_remaining -= 1;
        if (g.lives_remaining <= 0) { g.lives_remaining = 0; g.phase = 'lost'; }
      }
    }
  });
});

route('POST', '/api/game/stop', (req, res, params, body) => withGame(req, res, body, (g) => {
  if (g.phase === 'playing' || g.phase === 'paused') g.phase = 'ended';
}));

// --- Content validation endpoint (offline validators, on demand) ------------
route('GET', '/api/v1/validate/:contentId', (req, res, params) => {
  const id = params.contentId;
  let def = null;
  if (id.startsWith('daily-')) def = dailyForDate(new Date(`${id.slice(6)}T00:00:00Z`));
  if (!def) return fail(res, 'unknown-content', 'No such content id', 404);
  const report = validateContent(def);
  ok(res, { report });
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { return fail(res, 'bad-request', 'Bad request'); }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.rx.exec(pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      try { body = await readBody(req); }
      catch (e) { return fail(res, 'bad-request', e.message || 'Bad request'); } // structured errors for malformed JSON
    }
    try { return r.handler(req, res, params, body); }
    catch (e) { return fail(res, 'internal', e.message || 'Internal error', 500); }
  }
  if (serveStatic(req, res, pathname)) return;
  fail(res, 'not-found', 'Not found', 404);
});

server.listen(PORT, () => {
  console.log(`Eight Webs server listening on http://localhost:${PORT}`);
});
