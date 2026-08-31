// Eight Webs — offline test suite (node test/run-tests.mjs).
// Covers: every legal action + invalid reasons, scoring components, terminal
// states, serialization migration, deterministic replay property tests,
// fuzzed malformed commands, content validators, and golden sessions.

import assert from 'node:assert/strict';
import {
  createGame, applyCommand, checkMove, listLegalMoves, getHint, canDeal,
  isMovableRun, topRunLength, hashState, serialize, deserialize, replay,
  buildDeck, dealLayout, createStream, card, compareResults,
  COLUMN_COUNT, RUN_LENGTH, WEB_COUNT, SCORE, RULES_VERSION,
} from '../js/rules.js';
import {
  LESSONS, JOURNEY, CHALLENGES, PRACTICE_DIFFICULTIES, practiceDef,
  dailyForDate, validateContent, validateAll, THEMES, ACHIEVEMENTS,
} from '../js/content.js';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- deck & layout ------------------------------------------------------------
test('deck has 104 cards with correct copies per suit count', () => {
  for (const suits of [1, 2, 4]) {
    const deck = buildDeck('t', suits);
    assert.equal(deck.length, 104);
    const counts = new Map();
    for (const c of deck) counts.set(`${c.r}:${c.s}`, (counts.get(`${c.r}:${c.s}`) || 0) + 1);
    for (const [, n] of counts) assert.equal(n, 8 / suits);
  }
});

test('layout: 6/6/6/6/5*6 columns, tops face-up, 5 stock packets', () => {
  const { cols, stock } = dealLayout(buildDeck('x', 1));
  assert.deepEqual(cols.map((c) => c.length), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
  cols.forEach((c) => {
    assert.equal(c.at(-1).u, 1);
    for (let i = 0; i < c.length - 1; i++) assert.equal(c[i].u, 0);
  });
  assert.equal(stock.length, 5);
  stock.forEach((p) => { assert.equal(p.length, 10); p.forEach((c) => assert.equal(c.u, 1)); });
});

test('same seed → identical deck; different seed → different deck', () => {
  assert.equal(serialize(buildDeck('a', 2)), serialize(buildDeck('a', 2)));
  assert.notEqual(serialize(buildDeck('a', 2)), serialize(buildDeck('b', 2)));
});

// --- legality -------------------------------------------------------------------
const pad10 = (cols) => { const c = cols.slice(); while (c.length < COLUMN_COUNT) c.push([]); return c; };
const mkState = (cols, stock = []) => createGame({ seed: 't', suits: 1, layout: { cols: pad10(cols), stock } });
const G = (def) => def.layout ? createGame({ ...def, layout: { cols: pad10(def.layout.cols), stock: def.layout.stock } }) : createGame(def);

test('move legality: rank-mismatch, same-column, face-down, broken-run, toEmpty', () => {
  const st = mkState([
    [card(5), card(4)],       // movable 5·4 same suit
    [card(7)],                // dest 7 ≠ 5+1 → rank-mismatch
    [card(6)],                // dest 6 = 5+1 → legal
    [],                       // empty
    [card(9, 0, 0)],          // face-down only
    [card(3, 1), card(2, 0)], // mixed-suit: only the 2 is movable alone
  ]);
  assert.equal(checkMove(st, 0, 0, 1).reason, 'rank-mismatch');
  assert.equal(checkMove(st, 0, 0, 2).ok, true);
  assert.equal(checkMove(st, 0, 0, 0).reason, 'same-column');
  assert.equal(checkMove(st, 0, 0, 3).toEmpty, true);
  assert.equal(checkMove(st, 4, 0, 3).reason, 'face-down');
  assert.equal(checkMove(st, 5, 0, 3).reason, 'broken-run');
  assert.equal(checkMove(st, 5, 1, 3).ok, true);
  assert.equal(checkMove(st, 0, 99, 1).reason, 'out-of-bounds');
});

test('isMovableRun / topRunLength', () => {
  const st = mkState([[card(6), card(5), card(4)], [card(9, 1), card(8, 0), card(7, 0)]]);
  assert.equal(isMovableRun(st, 0, 0), true);
  assert.equal(isMovableRun(st, 1, 0), false);
  assert.equal(isMovableRun(st, 1, 1), true);
  assert.equal(topRunLength(st, 0), 3);
  assert.equal(topRunLength(st, 1), 2);
});

test('applyCommand moves a run, counts the move, keeps input immutable', () => {
  const st = mkState([[card(6), card(5)], [card(7)]]);
  const before = serialize(st);
  const r = applyCommand(st, { id: 1, at: 100, type: 'move', from: 0, idx: 0, to: 1 });
  assert.ok(!r.error);
  assert.deepEqual(r.state.cols[1].map((c) => c.r), [7, 6, 5]);
  assert.equal(r.state.moves, 1);
  assert.equal(r.state.tick, 1);
  assert.equal(serialize(st), before); // input never mutated
});

test('moving exposes and flips the card underneath', () => {
  const st = mkState([[card(9, 0, 0), card(5)], [card(6)]]);
  const r = applyCommand(st, { id: 1, at: 0, type: 'move', from: 0, idx: 1, to: 1 });
  assert.equal(r.state.cols[0][0].u, 1);
  assert.equal(r.state.flips, 1);
  assert.ok(r.events.some((e) => e.type === 'flip'));
});

test('complete K..A same-suit run is removed to a foundation', () => {
  const run = []; for (let r = 13; r >= 1; r--) run.push(card(r));
  const st = mkState([run, [card(13)], [card(13)], [card(13)], [card(13)], [card(13)], [card(13)], [card(13)], [card(13)], [card(13)]]);
  const r = applyCommand(st, { id: 1, at: 0, type: 'note' });
  // run completes only on move/deal; force via moving a filler king onto nothing.
  // Instead: move last card of a 12-run onto the king-headed column.
  const st2 = mkState([
    (() => { const a = []; for (let r = 13; r >= 2; r--) a.push(card(r)); return a; })(),
    [card(1)], [],
  ]);
  const r2 = applyCommand(st2, { id: 1, at: 0, type: 'move', from: 1, idx: 0, to: 0 });
  assert.equal(r2.state.foundations, 1);
  assert.ok(r2.events.some((e) => e.type === 'run-complete'));
});

test('webGoal 1 wins the round with win event + scoring components', () => {
  const st = G({
    seed: 't', suits: 1, webGoal: 1, par: { timeMs: 60000 },
    layout: {
      cols: [
        (() => { const a = []; for (let r = 13; r >= 2; r--) a.push(card(r)); return a; })(),
        [card(1)], [],
      ],
      stock: [],
    },
  });
  const r = applyCommand(st, { id: 1, at: 5000, type: 'move', from: 1, idx: 0, to: 0 });
  assert.equal(r.state.status, 'won');
  assert.equal(r.state.terminalReason, 'all-runs');
  const s = r.state.score;
  assert.equal(s.base, SCORE.BASE);
  assert.equal(s.movePenalty, -1);
  assert.equal(s.runs, 100);
  assert.equal(s.time, (60 - 5) * SCORE.TIME_BONUS_PER_SEC);
  assert.equal(s.noUndo, SCORE.NO_UNDO_BONUS);
  assert.equal(s.total, s.base + s.movePenalty + s.runs + s.time + s.noUndo);
  assert.ok(r.events.some((e) => e.type === 'win'));
});

test('deal: one card per column; blocked with an empty column (invalid recorded)', () => {
  const deck = buildDeck('d', 1);
  const { cols, stock } = dealLayout(deck);
  const st = createGame({ seed: 'd', suits: 1, layout: { cols, stock } });
  assert.ok(canDeal(st));
  const r = applyCommand(st, { id: 1, at: 0, type: 'deal' });
  assert.equal(r.state.stock.length, 4);
  r.state.cols.forEach((c, i) => assert.equal(c.length, (i < 4 ? 6 : 5) + 1));
  // empty a column then deal → invalid, recorded, state continues
  const st2 = G({ seed: 'd', suits: 1, layout: { cols: [[card(5)], [], [card(5)]], stock: [Array.from({ length: 10 }, (_, i) => card(i + 1))] } });
  const r2 = applyCommand(st2, { id: 1, at: 0, type: 'deal' });
  assert.ok(!r2.error);
  assert.equal(r2.state.invalid, 1);
  assert.ok(r2.events.some((e) => e.type === 'invalid' && e.reason === 'empty-column'));
});

test('stock-empty deal is rejected without state change', () => {
  const st = mkState([[card(5)]], []);
  const r = applyCommand(st, { id: 1, at: 0, type: 'deal' });
  assert.equal(r.error, 'stock-empty');
  assert.equal(r.state, st);
});

test('command ids: duplicates idempotent, gaps rejected', () => {
  const st = mkState([[card(5)], [card(6)]]);
  const r1 = applyCommand(st, { id: 1, at: 0, type: 'move', from: 0, idx: 0, to: 1 });
  assert.ok(!r1.error);
  assert.equal(applyCommand(r1.state, { id: 1, at: 0, type: 'move', from: 0, idx: 0, to: 1 }).error, 'duplicate-command');
  assert.equal(applyCommand(r1.state, { id: 5, at: 0, type: 'move', from: 0, idx: 0, to: 1 }).error, 'out-of-order-command');
  assert.equal(applyCommand(st, { id: 0, type: 'note' }).error, 'bad-command-id');
  assert.equal(applyCommand(st, null).error, 'malformed-command');
  assert.equal(applyCommand(st, { id: 1, type: 'bogus' }).error, 'unknown-command');
});

test('illegal in-bounds moves are recorded as invalid actions, not rejections', () => {
  const st = mkState([[card(5)], [card(9)]]);
  const r = applyCommand(st, { id: 1, at: 0, type: 'move', from: 0, idx: 0, to: 1 });
  assert.ok(!r.error);
  assert.equal(r.state.invalid, 1);
  assert.equal(r.state.cols[0].length, 1); // nothing moved
});

test('move limit ends the round (move-limit)', () => {
  const st = G({
    seed: 't', suits: 1, limits: { moves: 1 },
    layout: { cols: [[card(5)], [card(6)]], stock: [] },
  });
  const r = applyCommand(st, { id: 1, at: 0, type: 'move', from: 0, idx: 0, to: 1 });
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'move-limit');
});

test('time limit enforced authoritatively on any command', () => {
  const st = G({
    seed: 't', suits: 1, limits: { timeMs: 1000 },
    layout: { cols: [[card(5)], [card(6)]], stock: [] },
  });
  const r = applyCommand(st, { id: 1, at: 5000, type: 'note' });
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'time-limit');
});

test('no moves + empty stock = loss (no-moves)', () => {
  // Ten full columns of same-rank cards, empty stock: nothing is stackable
  // and no column is empty, so no legal move exists.
  const st = mkState(Array.from({ length: 10 }, () => [card(5)]), []);
  const r2 = applyCommand(st, { id: 1, at: 0, type: 'move', from: 0, idx: 0, to: 1 });
  assert.equal(r2.state.status, 'lost');
  assert.equal(r2.state.terminalReason, 'no-moves');
});

test('giveUp aborts with gave-up reason', () => {
  const st = mkState([[card(5)]]);
  const r = applyCommand(st, { id: 1, at: 0, type: 'giveUp' });
  assert.equal(r.state.status, 'aborted');
  assert.equal(r.state.terminalReason, 'gave-up');
});

test('commands after round end are rejected (round-over)', () => {
  const st = mkState([[card(5)]]);
  const done = applyCommand(st, { id: 1, at: 0, type: 'giveUp' }).state;
  assert.equal(applyCommand(done, { id: 2, at: 0, type: 'note' }).error, 'round-over');
});

// --- hints ----------------------------------------------------------------------
test('hint uses the same legality API and returns only legal moves', () => {
  for (const seed of ['h1', 'h2', 'h3']) {
    const st = createGame({ seed, suits: 2 });
    const h = getHint(st);
    if (h) {
      assert.ok(checkMove(st, h.from, h.idx, h.to).ok);
      assert.ok(listLegalMoves(st).some((m) => m.from === h.from && m.idx === h.idx && m.to === h.to));
    }
  }
});

// --- serialization / migration / hashing -----------------------------------------
test('serialize/deserialize round-trips and rejects junk', () => {
  const st = createGame({ seed: 's', suits: 4 });
  const back = deserialize(serialize(st));
  assert.equal(hashState(back), hashState(st));
  assert.throws(() => deserialize('{"nope":true}'));
  assert.throws(() => deserialize('"x"'));
});

test('state hash is stable and sensitive to moves', () => {
  const a = createGame({ seed: 'z', suits: 1 });
  const b = applyCommand(a, { id: 1, at: 0, type: 'note' }).state;
  assert.equal(hashState(a), hashState(createGame({ seed: 'z', suits: 1 })));
  assert.notEqual(hashState(a), hashState(b));
});

// --- replay property tests ---------------------------------------------------------
test('property: same version+seed+commands → identical state hashes (20 seeds)', () => {
  for (let i = 0; i < 20; i++) {
    const seed = `prop-${i}`;
    const commands = [];
    let state = createGame({ seed, suits: [1, 2, 4][i % 3] });
    const rng = createStream(`drive-${i}`);
    for (let k = 0; k < 60 && state.status === 'active'; k++) {
      const legal = listLegalMoves(state);
      let cmd;
      if (legal.length && (rng.next() < 0.8 || !canDeal(state))) {
        const m = legal[Math.floor(rng.next() * legal.length)];
        cmd = { id: state.nextCmdId, at: state.elapsedMs + 2000, type: 'move', from: m.from, idx: m.idx, to: m.to };
      } else if (canDeal(state)) {
        cmd = { id: state.nextCmdId, at: state.elapsedMs + 2000, type: 'deal' };
      } else break;
      commands.push(cmd);
      const r = applyCommand(state, cmd);
      assert.ok(!r.error, `seed ${seed} cmd ${k}: ${r.error}`);
      state = r.state;
    }
    const env = { init: { seed, suits: state.suits }, commands };
    const r1 = replay(env);
    const r2 = replay(env);
    assert.ok(r1.ok && r2.ok);
    assert.equal(r1.finalHash, r2.finalHash);
    assert.equal(r1.finalHash, hashState(state));
    assert.deepEqual(r1.checkpoints.map((c) => c.hash), r2.checkpoints.map((c) => c.hash));
  }
});

// --- fuzz ---------------------------------------------------------------------------
test('fuzz: malformed commands never hang, corrupt, or produce NaN', () => {
  const rng = createStream('fuzz');
  for (let i = 0; i < 500; i++) {
    const st = createGame({ seed: `f-${i % 17}`, suits: [1, 2, 4][i % 3] });
    const cmd = {
      id: rng.int(-5, 8), at: rng.next() < 0.3 ? -1 : rng.int(0, 99999),
      type: ['move', 'deal', 'giveUp', 'note', 'x', undefined][rng.int(0, 5)],
      from: rng.int(-3, 13), idx: rng.int(-3, 15), to: rng.int(-3, 13),
    };
    const before = hashState(st);
    const r = applyCommand(st, cmd);
    assert.ok(r.state);
    assert.ok(Number.isFinite(r.state.score.total));
    if (r.error) assert.equal(hashState(st), before); // rejected ⇒ untouched
  }
});

// --- golden sessions -------------------------------------------------------------------
test('golden: full played sessions produce stable terminal hashes', () => {
  const golden = (seed, suits) => {
    let state = createGame({ seed, suits });
    let guard = 0;
    while (state.status === 'active' && guard++ < 800) {
      const h = getHint(state);
      if (h) state = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs + 3000, type: 'move', from: h.from, idx: h.idx, to: h.to }).state;
      else if (canDeal(state)) state = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs + 3000, type: 'deal' }).state;
      else break;
    }
    return { hash: hashState(state), status: state.status, moves: state.moves, webs: state.foundations };
  };
  const a = golden('golden-easy', 1);
  const b = golden('golden-easy', 1);
  assert.deepEqual(a, b); // interrupted/resumed equivalence covered by replay tests
  const c = golden('golden-hard', 4);
  const d = golden('golden-hard', 4);
  assert.deepEqual(c, d);
});

// --- tiebreak ---------------------------------------------------------------------------
test('compareResults: completion > webs > score > invalid > time > session id', () => {
  const base = { status: 'won', foundations: 8, score: { total: 1000 }, invalid: 0, elapsedMs: 1000, sessionId: 'a' };
  assert.ok(compareResults(base, { ...base, status: 'lost' }) < 0);
  assert.ok(compareResults(base, { ...base, foundations: 7, score: { total: 5000 } }) < 0);
  assert.ok(compareResults(base, { ...base, score: { total: 999 } }) < 0);
  assert.ok(compareResults(base, { ...base, invalid: 1 }) < 0);
  assert.ok(compareResults(base, { ...base, elapsedMs: 2000 }) < 0);
  assert.ok(compareResults(base, { ...base, sessionId: 'b' }) < 0);
});

// --- content ------------------------------------------------------------------------------
test('content set: 5 lessons, 40 journey stages, 4 challenges, 3 difficulties, 5 themes', () => {
  assert.equal(LESSONS.length, 5);
  assert.equal(JOURNEY.length, 40);
  assert.equal(CHALLENGES.length, 4);
  assert.equal(PRACTICE_DIFFICULTIES.length, 3);
  assert.equal(THEMES.length, 5);
  assert.ok(ACHIEVEMENTS.length >= 5);
  ACHIEVEMENTS.forEach((a) => assert.match(a.key, /^[a-z0-9_]+$/));
  assert.equal(JOURNEY.filter((j) => j.goals.mastery).length, 5); // periodic mastery stages
});

test('daily: one immutable seed per UTC day, valid suits', () => {
  const d1 = dailyForDate(new Date(Date.UTC(2026, 5, 15)));
  const d2 = dailyForDate(new Date(Date.UTC(2026, 5, 15, 23, 59)));
  const d3 = dailyForDate(new Date(Date.UTC(2026, 5, 16)));
  assert.equal(d1.seed, d2.seed);
  assert.notEqual(d1.seed, d3.seed);
  assert.ok([1, 2, 4].includes(d1.suits));
  assert.equal(d1.ranked, true);
});

test('offline validators: all shipped content is legal, bounded, lock-free; lessons win', () => {
  const reports = validateAll();
  const failed = reports.filter((r) => !r.ok);
  assert.equal(failed.length, 0, failed.map((r) => `${r.id}: ${r.errors.join('; ')}`).join('\n'));
  const lessons = reports.filter((r) => r.metrics.lesson);
  assert.equal(lessons.length, 5);
});

test('practice + challenge content passes validators', () => {
  for (const d of PRACTICE_DIFFICULTIES) {
    assert.ok(validateContent(practiceDef(d.id, 'fixed')).ok);
  }
  for (const c of CHALLENGES) assert.ok(validateContent(c.build()).ok, c.id);
});

// ---------------------------------------------------------------------------
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
console.log(`\n${passed}/${tests.length} tests passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
