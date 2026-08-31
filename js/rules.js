// Eight Webs — deterministic rules engine.
// Pure module: no DOM, no rendering, no I/O. Same file runs in browser and Node.
//
// Rules contract (card sequencing puzzle):
//  - 104 cards across ten tableau columns. Difficulty sets how many distinct
//    suits are in play: 1 suit (8 copies of each rank), 2 suits (4 copies),
//    or 4 suits (2 copies). Ranks run 1 (Ace) .. 13 (King).
//  - A face-up descending SAME-SUIT run travels together. It may be placed on
//    a column whose top card is exactly one rank higher (any suit), or on an
//    empty column.
//  - Moving or dealing exposes cards; a newly exposed face-down card flips up.
//  - A complete King-to-Ace same-suit run (13 cards) at a column top is removed
//    to a foundation web. Eight webs wins the round.
//  - The stock holds five packets of ten cards. Dealing places one face-up card
//    on every column and is only legal when no column is empty.
//  - Loss: move/time limit exceeded, or no legal moves with an empty stock.
// Determinism: state changes happen only through applyCommand(); identical
// (version, seed, command list) always yields identical state hashes.

export const RULES_VERSION = 1;
export const COLUMN_COUNT = 10;
export const RUN_LENGTH = 13;
export const WEB_COUNT = 8;
export const STOCK_PACKETS = 5;

export const SCORE = {
  BASE: 500,
  MOVE_PENALTY: -1,
  RUN: 100,
  TIME_BONUS_PER_SEC: 2,
  NO_UNDO_BONUS: 50,
};

// ---------------------------------------------------------------------------
// Seeded random streams (rules / decoration / audiovisual stay separate)
// ---------------------------------------------------------------------------

export function hashSeed(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createStream(seed) {
  // mulberry32
  let s = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    getState: () => s,
  };
}

// ---------------------------------------------------------------------------
// Cards: { r: rank 1..13, s: suit 0..3, u: 1 face-up / 0 face-down }
// ---------------------------------------------------------------------------

export function card(r, s, u = 1) {
  return { r, s, u };
}

export function rankLabel(r) {
  return r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
}

export function cardLabel(c) {
  return `${rankLabel(c.r)}·s${c.s}`;
}

// Build the 104-card deck for a suit count, shuffled by the rules stream.
export function buildDeck(seed, suits) {
  if (![1, 2, 4].includes(suits)) throw new Error('buildDeck: suits must be 1, 2 or 4');
  const copies = 8 / suits;
  const deck = [];
  for (let s = 0; s < suits; s++) {
    for (let k = 0; k < copies; k++) {
      for (let r = 1; r <= 13; r++) deck.push(card(r, s, 0));
    }
  }
  createStream(`deck:${seed}`).shuffle(deck);
  return deck;
}

// Standard opening layout: columns 0-3 get 6 cards, 4-9 get 5; each column's
// top card face-up; the remaining 50 cards become five 10-card stock packets.
export function dealLayout(deck) {
  if (deck.length !== 104) throw new Error('dealLayout: deck must hold 104 cards');
  const cols = Array.from({ length: COLUMN_COUNT }, () => []);
  let p = 0;
  for (let c = 0; c < COLUMN_COUNT; c++) {
    const n = c < 4 ? 6 : 5;
    for (let i = 0; i < n; i++) cols[c].push(deck[p++]);
    cols[c][n - 1].u = 1;
  }
  const stock = [];
  for (let k = 0; k < STOCK_PACKETS; k++) {
    stock.push(deck.slice(p, p + COLUMN_COUNT).map((c) => ({ ...c, u: 1 })));
    p += COLUMN_COUNT;
  }
  return { cols, stock };
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

// def: { seed, suits, layout?: {cols, stock}, limits:{moves,timeMs},
//        par:{moves,timeMs}, mode, contentId, mechanics:[] }
export function createGame(def) {
  const suits = def.suits || 1;
  let cols;
  let stock;
  if (def.layout) {
    cols = def.layout.cols.map((col) => col.map((c) => ({ ...c })));
    stock = (def.layout.stock || []).map((pk) => pk.map((c) => ({ ...c })));
    if (cols.length !== COLUMN_COUNT) throw new Error('createGame: layout needs ten columns');
  } else {
    ({ cols, stock } = dealLayout(buildDeck(def.seed, suits)));
  }
  return {
    v: RULES_VERSION,
    seed: String(def.seed),
    contentId: def.contentId || null,
    mode: def.mode || 'practice',
    suits,
    cols,
    stock,
    foundations: 0,
    webGoal: def.webGoal ?? WEB_COUNT, // webs required to win (lessons use 1)
    tick: 0,                 // monotonically increasing command tick
    nextCmdId: 1,            // action identifiers prevent double commits
    status: 'active',        // active | won | lost | aborted
    terminalReason: null,    // all-runs | move-limit | time-limit | no-moves | gave-up
    elapsedMs: 0,
    moves: 0,
    invalid: 0,
    undos: 0,
    dealsUsed: 0,
    flips: 0,
    score: { base: SCORE.BASE, movePenalty: 0, runs: 0, time: 0, noUndo: 0, total: SCORE.BASE },
    limits: { moves: def.limits?.moves ?? null, timeMs: def.limits?.timeMs ?? null },
    par: { moves: def.par?.moves ?? null, timeMs: def.par?.timeMs ?? null },
    mechanics: Array.isArray(def.mechanics) ? def.mechanics.slice() : [],
  };
}

// ---------------------------------------------------------------------------
// Legality queries (shared by play, hints and tutorials)
// ---------------------------------------------------------------------------

export function topCard(state, col) {
  const c = state.cols[col];
  return c.length ? c[c.length - 1] : null;
}

// Is col[idx..end] a movable descending same-suit run of face-up cards?
export function isMovableRun(state, from, idx) {
  const col = state.cols[from];
  if (!col || idx < 0 || idx >= col.length) return false;
  for (let i = idx; i < col.length; i++) {
    if (!col[i].u) return false;
    if (i > idx && (col[i].s !== col[i - 1].s || col[i].r !== col[i - 1].r - 1)) return false;
  }
  return true;
}

// Length of the face-up same-suit descending run ending at the column top.
export function topRunLength(state, col) {
  const c = state.cols[col];
  let n = 0;
  for (let i = c.length - 1; i >= 0; i--) {
    if (!c[i].u) break;
    if (n > 0 && (c[i].s !== c[i + 1].s || c[i].r !== c[i + 1].r + 1)) break;
    n++;
  }
  return n;
}

// Full legality check with an explanatory reason for invalid actions.
export function checkMove(state, from, idx, to) {
  if (state.status !== 'active') return { ok: false, reason: 'round-over' };
  const inBounds = Number.isInteger(from) && Number.isInteger(to) && Number.isInteger(idx) &&
    from >= 0 && from < COLUMN_COUNT && to >= 0 && to < COLUMN_COUNT &&
    idx >= 0 && idx < (state.cols[from]?.length ?? 0);
  if (!inBounds) return { ok: false, reason: 'out-of-bounds' };
  if (from === to) return { ok: false, reason: 'same-column' };
  if (!state.cols[from][idx].u) return { ok: false, reason: 'face-down' };
  if (!isMovableRun(state, from, idx)) return { ok: false, reason: 'broken-run' };
  const moving = state.cols[from][idx];
  const dest = topCard(state, to);
  if (!dest) return { ok: true, reason: null, toEmpty: true, count: state.cols[from].length - idx };
  if (dest.r !== moving.r + 1) return { ok: false, reason: 'rank-mismatch' };
  return { ok: true, reason: null, toEmpty: false, count: state.cols[from].length - idx };
}

export function listLegalMoves(state) {
  const out = [];
  if (state.status !== 'active') return out;
  for (let from = 0; from < COLUMN_COUNT; from++) {
    const col = state.cols[from];
    for (let idx = 0; idx < col.length; idx++) {
      if (!col[idx].u || !isMovableRun(state, from, idx)) continue;
      for (let to = 0; to < COLUMN_COUNT; to++) {
        const check = checkMove(state, from, idx, to);
        if (check.ok) out.push({ from, idx, to, count: check.count, toEmpty: check.toEmpty });
      }
    }
  }
  return out;
}

// Hints and tutorials call the exact same legality API as play.
// Preference: complete a run > reveal a face-down card > build in-suit >
// non-empty destination > anything legal.
export function getHint(state) {
  const moves = listLegalMoves(state);
  if (!moves.length) return null;
  const scored = moves.map((m) => {
    let score = 0;
    const moving = state.cols[m.from][m.idx];
    const dest = topCard(state, m.to);
    const runLen = topRunLength(state, m.to);
    if (dest && dest.s === moving.s && runLen + m.count >= RUN_LENGTH) score += 1000;
    if (m.idx > 0 && !state.cols[m.from][m.idx - 1].u) score += 120; // flips a card
    if (dest && dest.s === moving.s) score += 60;                    // in-suit build
    if (!m.toEmpty) score += 10;
    if (m.toEmpty && m.idx === 0) score -= 50;                       // shuffling a whole column
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score || a.m.from - b.m.from || a.m.to - b.m.to || a.m.idx - b.m.idx);
  return scored[0].m;
}

export function canDeal(state) {
  return state.status === 'active' && state.stock.length > 0 &&
    state.cols.every((c) => c.length > 0);
}

export function cardsInPlay(state) {
  let n = 0;
  for (const col of state.cols) n += col.length;
  return n;
}

export function faceDownCount(state) {
  let n = 0;
  for (const col of state.cols) for (const c of col) if (!c.u) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Command application — the only way rules state ever changes
// ---------------------------------------------------------------------------

function cloneState(state) {
  return {
    ...state,
    cols: state.cols.map((col) => col.map((c) => ({ ...c }))),
    stock: state.stock.map((pk) => pk.map((c) => ({ ...c }))),
    score: { ...state.score },
    limits: { ...state.limits },
    par: { ...state.par },
    mechanics: state.mechanics.slice(),
  };
}

function recomputeTotal(state) {
  const s = state.score;
  s.movePenalty = state.moves * SCORE.MOVE_PENALTY;
  s.runs = state.foundations * SCORE.RUN;
  s.total = Math.max(0, s.base + s.movePenalty + s.runs + s.time + s.noUndo);
}

function flipExposed(state, col, events) {
  const c = state.cols[col];
  if (c.length && !c[c.length - 1].u) {
    c[c.length - 1].u = 1;
    state.flips += 1;
    events.push({ type: 'flip', col, card: { ...c[c.length - 1] } });
  }
}

// Remove complete K..A same-suit runs sitting at a column's top. Loops in
// case removal exposes another complete run (defensive; normally one pass).
function collectRuns(state, col, events) {
  let guard = 0;
  for (;;) {
    if (++guard > WEB_COUNT + 2) throw new Error('collectRuns: unbounded loop');
    const c = state.cols[col];
    if (c.length < RUN_LENGTH) return;
    const start = c.length - RUN_LENGTH;
    const base = c[start];
    if (!base.u || base.r !== 13) return;
    let complete = true;
    for (let i = 1; i < RUN_LENGTH; i++) {
      const x = c[start + i];
      if (!x.u || x.s !== base.s || x.r !== 13 - i) { complete = false; break; }
    }
    if (!complete) return;
    const removed = c.splice(start, RUN_LENGTH);
    state.foundations += 1;
    state.score.runs = state.foundations * SCORE.RUN;
    events.push({ type: 'run-complete', col, suit: base.s, cards: removed.map((x) => ({ ...x })) });
    flipExposed(state, col, events);
  }
}

function finish(state, events, status, reason) {
  state.status = status;
  state.terminalReason = reason;
  if (status === 'won') {
    if (state.par.timeMs != null && state.elapsedMs < state.par.timeMs) {
      state.score.time += Math.floor((state.par.timeMs - state.elapsedMs) / 1000) * SCORE.TIME_BONUS_PER_SEC;
    }
    if (state.undos === 0) state.score.noUndo += SCORE.NO_UNDO_BONUS;
    recomputeTotal(state);
    events.push({ type: 'win', score: { ...state.score } });
  } else {
    recomputeTotal(state);
    events.push({ type: 'lose', reason, score: { ...state.score } });
  }
}

function checkTerminal(state, events) {
  if (state.foundations >= state.webGoal) {
    finish(state, events, 'won', 'all-runs');
    return true;
  }
  if (state.limits.moves != null && state.moves >= state.limits.moves) {
    finish(state, events, 'lost', 'move-limit');
    return true;
  }
  if (state.stock.length === 0 && listLegalMoves(state).length === 0 && cardsInPlay(state) > 0) {
    finish(state, events, 'lost', 'no-moves');
    return true;
  }
  return false;
}

// cmd: { id, at, type:'move'|'deal'|'giveUp'|'note', from?, idx?, to? }
// Returns { state, events } on success or { state, error } on rejection.
// The input state is never mutated; the returned state is a new object.
export function applyCommand(state, cmd) {
  if (!cmd || typeof cmd !== 'object') return { state, error: 'malformed-command' };
  if (!Number.isInteger(cmd.id) || cmd.id < 1) return { state, error: 'bad-command-id' };
  if (cmd.id < state.nextCmdId) return { state, error: 'duplicate-command' }; // idempotent reject
  if (cmd.id > state.nextCmdId) return { state, error: 'out-of-order-command' };
  const at = Number.isFinite(cmd.at) && cmd.at >= 0 ? Math.floor(cmd.at) : state.elapsedMs;

  const s = cloneState(state);
  s.nextCmdId = cmd.id + 1;
  s.tick += 1;
  s.elapsedMs = Math.max(s.elapsedMs, at);
  const events = [];

  if (s.status !== 'active') return { state, error: 'round-over' };

  // Authoritative clock: time limit enforced on every command.
  if (s.limits.timeMs != null && s.elapsedMs > s.limits.timeMs) {
    finish(s, events, 'lost', 'time-limit');
    return { state: s, events };
  }

  switch (cmd.type) {
    case 'move': {
      const check = checkMove(s, cmd.from, cmd.idx, cmd.to);
      if (!check.ok) {
        if (check.reason === 'round-over') return { state, error: 'round-over' };
        if (check.reason === 'out-of-bounds') return { state, error: 'out-of-bounds' };
        // In-bounds but illegal: recorded as an invalid action (tiebreaker)
        // rather than rejecting the command.
        s.invalid += 1;
        events.push({ type: 'invalid', reason: check.reason, from: cmd.from, idx: cmd.idx, to: cmd.to });
        if (!checkTerminal(s, events)) recomputeTotal(s);
        return { state: s, events };
      }
      const moving = s.cols[cmd.from].splice(cmd.idx);
      const fromCol = cmd.from;
      for (const c of moving) s.cols[cmd.to].push(c);
      s.moves += 1;
      events.push({
        type: 'move', from: fromCol, idx: cmd.idx, to: cmd.to,
        count: moving.length, toEmpty: check.toEmpty,
        cards: moving.map((c) => ({ ...c })),
      });
      flipExposed(s, fromCol, events);
      collectRuns(s, cmd.to, events);
      if (!checkTerminal(s, events)) recomputeTotal(s);
      return { state: s, events };
    }
    case 'deal': {
      if (s.stock.length === 0) return { state, error: 'stock-empty' };
      if (!s.cols.every((c) => c.length > 0)) {
        // Dealing with an empty column is a rule violation, recorded.
        s.invalid += 1;
        events.push({ type: 'invalid', reason: 'empty-column' });
        if (!checkTerminal(s, events)) recomputeTotal(s);
        return { state: s, events };
      }
      const packet = s.stock.shift();
      for (let c = 0; c < COLUMN_COUNT; c++) s.cols[c].push(packet[c]);
      s.dealsUsed += 1;
      events.push({ type: 'deal', remaining: s.stock.length });
      for (let c = 0; c < COLUMN_COUNT; c++) collectRuns(s, c, events);
      if (!checkTerminal(s, events)) recomputeTotal(s);
      return { state: s, events };
    }
    case 'giveUp': {
      finish(s, events, 'aborted', 'gave-up');
      return { state: s, events };
    }
    case 'note': // heartbeat / elapsed-time sync; affects only the clock + limits
      recomputeTotal(s);
      return { state: s, events };
    default:
      return { state, error: 'unknown-command' };
  }
}

// ---------------------------------------------------------------------------
// Serialization, migration, hashing (replay + persistence)
// ---------------------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

const MIGRATIONS = {
  // version N -> N+1 handlers live here as the schema evolves
};

export function deserialize(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  if (!s || typeof s !== 'object' || !Array.isArray(s.cols) || !Array.isArray(s.stock)) {
    throw new Error('deserialize: not an Eight Webs state');
  }
  let v = s.v ?? 1;
  while (v < RULES_VERSION) {
    const mig = MIGRATIONS[v];
    if (!mig) throw new Error(`deserialize: no migration from v${v}`);
    Object.assign(s, mig(s));
    v = s.v;
  }
  return s;
}

export function hashState(state) {
  // Stable FNV-1a over the authoritative fields (order-independent formatting).
  const flat = (cols) => cols.map((col) => col.map((c) => `${c.r}${'abcd'[c.s]}${c.u}`).join('.')).join('/');
  const parts = [
    state.v, state.suits, state.tick, state.status, state.terminalReason ?? '-',
    state.moves, state.invalid, state.dealsUsed, state.foundations, state.flips,
    state.elapsedMs, state.score.total,
    flat(state.cols), flat(state.stock),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Replay an envelope and report per-checkpoint validity (used by the
// authoritative validation script and by the property tests).
export function replay(envelope) {
  const def = envelope.init;
  let state = createGame(def);
  const checkpoints = [{ after: 0, hash: hashState(state) }];
  const events = [];
  for (const cmd of envelope.commands) {
    const r = applyCommand(state, cmd);
    if (r.error) return { ok: false, error: r.error, atCommand: cmd.id };
    state = r.state;
    events.push(...(r.events || []));
    checkpoints.push({ after: cmd.id, hash: hashState(state) });
  }
  return {
    ok: true,
    final: state,
    finalHash: hashState(state),
    checkpoints,
    events,
  };
}

// Tiebreak order: primary objective completion (webs, then score), fewer
// invalid actions, lower authoritative elapsed time, stable session id.
// Returns negative when a ranks above b.
export function compareResults(a, b) {
  const rank = (r) => (r.status === 'won' ? 0 : r.status === 'lost' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const fa = a.foundations ?? 0;
  const fb = b.foundations ?? 0;
  if (fa !== fb) return fb - fa;
  if (a.score.total !== b.score.total) return b.score.total - a.score.total;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}
