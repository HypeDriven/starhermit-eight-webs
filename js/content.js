// Eight Webs — versioned content: themes, suits, journey, lessons, daily,
// practice, challenges, and offline validators. Pure module (browser + Node).

import {
  createStream, hashSeed, createGame, applyCommand, listLegalMoves, getHint,
  canDeal, hashState, card, RULES_VERSION, COLUMN_COUNT, WEB_COUNT,
} from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Suits are silk threads: color AND shape reinforce every color cue.
// ---------------------------------------------------------------------------

export const SUITS = [
  { id: 0, name: 'Crimson thread', glyph: '●', color: '#c0392b' },
  { id: 1, name: 'Amber thread', glyph: '◆', color: '#c97b12' },
  { id: 2, name: 'Jade thread', glyph: '▲', color: '#1f8a70' },
  { id: 3, name: 'Indigo thread', glyph: '■', color: '#3457c9' },
];

// ---------------------------------------------------------------------------
// Visual themes (presentation only — never affect rules or information)
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'shadowbox', name: 'Shadow Box',
    paper: '#efe7d8', ink: '#2e2a24', rule: '#c9bda6', panel: '#faf5ea',
    felt: '#5d4a38', feltEdge: '#3c2f22', frame: '#7a5f44',
    card: '#fdfaf2', cardEdge: '#d8cdb4', accent: '#b0622a', select: '#2f80ed',
    legal: '#3f9d63', danger: '#c0392b', sky: '#e4dbc8',
  },
  {
    id: 'midnight', name: 'Midnight Silk',
    paper: '#1d2233', ink: '#e6e2d6', rule: '#39415c', panel: '#262c42',
    felt: '#232a44', feltEdge: '#151a2c', frame: '#4a5578',
    card: '#e9e6da', cardEdge: '#b9b4a2', accent: '#e0a458', select: '#7aa5f8',
    legal: '#6fcf97', danger: '#eb5757', sky: '#12162a',
  },
  {
    id: 'jade', name: 'Jade Loom',
    paper: '#e6f0ea', ink: '#1e322a', rule: '#aecdc0', panel: '#f4fbf7',
    felt: '#274d40', feltEdge: '#17332a', frame: '#3f6b58',
    card: '#fbfdf9', cardEdge: '#c2d8cb', accent: '#c96f2e', select: '#2f80ed',
    legal: '#3f9d63', danger: '#c0392b', sky: '#d4e6dc',
  },
  {
    id: 'porcelain', name: 'Porcelain Case',
    paper: '#eef1f6', ink: '#252b3a', rule: '#c3ccda', panel: '#fafbfd',
    felt: '#8b9bb8', feltEdge: '#66759a', frame: '#a4b2ca',
    card: '#ffffff', cardEdge: '#ccd4e2', accent: '#5b5fc7', select: '#2f80ed',
    legal: '#3f9d63', danger: '#c0392b', sky: '#dfe5ef',
  },
  {
    id: 'ember', name: 'Ember Thread',
    paper: '#f3e6e0', ink: '#3a2320', rule: '#d8bcb2', panel: '#fdf3ee',
    felt: '#5a3230', feltEdge: '#3c1f1e', frame: '#7c4a42',
    card: '#fef9f5', cardEdge: '#e0c8bc', accent: '#b03a2e', select: '#7a4de8',
    legal: '#3f9d63', danger: '#c0392b', sky: '#ecd8d0',
  },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ---------------------------------------------------------------------------
// Content definition wrapper
// ---------------------------------------------------------------------------

let defCounter = 0;
export function makeDef(partial) {
  return {
    v: CONTENT_VERSION,
    rulesV: RULES_VERSION,
    id: partial.id || `gen-${++defCounter}`,
    seed: String(partial.seed),
    suits: partial.suits || 1,
    layout: partial.layout || null,
    webGoal: partial.webGoal ?? WEB_COUNT,
    goals: partial.goals || { type: 'clear-webs' },
    limits: partial.limits || {},
    par: partial.par || {},
    mechanics: partial.mechanics || [],
    tutorial: partial.tutorial || null,
    theme: partial.theme || 'shadowbox',
    mode: partial.mode || 'practice',
    title: partial.title || 'Untitled',
    assists: partial.assists ?? { hints: true, undo: true },
    ranked: partial.ranked ?? false,
  };
}

// ---------------------------------------------------------------------------
// Learn — interactive lessons, one rule at a time, player must perform it.
// Each lesson is a small authored layout whose taught steps end by clearing
// one web (webGoal 1), so every lesson reaches a real win state.
// ---------------------------------------------------------------------------

const C = (r, s = 0, u = 1) => card(r, s, u);
const run = (hi, lo, s = 0, u = 1) => { // inclusive descending run of cards
  const out = [];
  for (let r = hi; r >= lo; r--) out.push(C(r, s, u));
  return out;
};

function lessonDef(id, title, cols, stock, steps, note) {
  while (cols.length < COLUMN_COUNT) cols.push([C(13)]); // inert filler kings
  return makeDef({
    id: `learn-${id}`, seed: `learn-${id}`, title, mode: 'learn',
    suits: 1, layout: { cols, stock }, webGoal: 1, theme: 'shadowbox',
    tutorial: { steps }, assists: { hints: true, undo: true },
    mechanics: ['move-runs'], goals: { type: 'clear-webs', note },
  });
}

export const LESSONS = [
  lessonDef(1, 'Build Down', [
    [C(1)],          // Ace
    [C(2)],          // Two
    run(13, 3),      // K..3 waiting in column three
  ], [], [
    { text: 'Cards stack downward: a card rests on the next rank up. Move the 2 onto the 3 at the foot of the long run.', require: { type: 'move', from: 1, to: 2 } },
    { text: 'Now set the Ace on the 2 — King down to Ace completes a web.', require: { type: 'move', from: 0, to: 2 } },
  ], 'Stack descending and clear your first web.'),

  lessonDef(2, 'Threads Travel Together', [
    run(6, 5),       // 6·5 in-suit run
    run(4, 1),       // 4·3·2·A in-suit run
    run(13, 7),      // K..7
  ], [], [
    { text: 'A descending run of one thread moves as a unit. Lift the 6·5 pair onto the 7.', require: { type: 'move', from: 0, to: 2 } },
    { text: 'Bring the 4·3·2·A thread over to finish the web.', require: { type: 'move', from: 1, to: 2 } },
  ], 'Whole in-suit runs move as one piece.'),

  lessonDef(3, 'Hidden Threads', [
    [C(6, 0, 0), ...run(8, 7)],   // face-down 6 under an 8·7 run
    run(5, 1),                    // 5·4·3·2·A
    run(13, 9),                   // K..9
  ], [], [
    { text: 'Face-down cards flip when uncovered. Move the 8·7 run onto the 9.', require: { type: 'move', from: 0, to: 2 } },
    { text: 'The hidden card turned face-up: a 6. Move the 5·4·3·2·A thread onto it.', require: { type: 'move', from: 1, to: 0 } },
    { text: 'Now the 6·5·4·3·2·A run joins the long thread — move it onto the 7 to complete the web.', require: { type: 'any-move' } },
  ], 'Uncovering a card turns it face-up.'),

  lessonDef(4, 'The Stock', [
    run(13, 3),      // K..3: one card short of a web
    [C(13)], [C(13)], [C(13)], [C(13)],
    [C(13)], [C(13)], [C(13)], [C(13)], [C(13)],
  ], [[C(2), C(1), C(13), C(13), C(13), C(13), C(13), C(13), C(13), C(13)]], [
    { text: 'The stock deals one new card onto every column — but only while no column is empty. Press Deal.', require: { type: 'any-deal' } },
    { text: 'A 2 landed on the long thread and an Ace beside it. Set the Ace on the 2 to complete the web.', require: { type: 'move', from: 1, to: 0 } },
  ], 'Deal fresh rows from the stock.'),

  lessonDef(5, 'The Open Column', [
    [],               // empty column: accepts any run
    run(13, 12),      // K·Q
    run(11, 10),      // J·10
    run(9, 8),
    run(7, 6),
    run(5, 4),
    run(3, 2),
    [C(1)],           // Ace
    [C(13)], [C(13)], // inert kings
  ], [], [
    { text: 'An empty column accepts any card or run — a precious work space. First, set the Ace on the 2.', require: { type: 'move', from: 7, to: 6 } },
    { text: 'Now cascade each pair upward: move the 3·2·A thread onto the 4, and keep going to the King.', require: { type: 'any-move' } },
  ], 'Empty columns are free work space.'),
];

// ---------------------------------------------------------------------------
// Journey — 40 authored stages across five webs (themes).
// One new concept in isolation → combine with a known concept → mastery test.
// ---------------------------------------------------------------------------

const JOURNEY_SCRIPT = [
  // Web 1 — Shadow Box: one thread, the core vocabulary
  { title: 'First Threads', suits: 1, mult: 1, note: 'One thread. Learn the table.' },
  { title: 'Long Runs', suits: 1, mult: 1, note: 'Build longer runs before dealing.' },
  { title: 'Open Spaces', suits: 1, mult: 1.1, note: 'Empty columns are leverage.' },
  { title: 'Hidden Half', suits: 1, mult: 1.1, note: 'Uncover the face-down cards early.' },
  { title: 'Patient Weave', suits: 1, mult: 1.2, note: 'Sometimes wait before you deal.' },
  { title: 'Tangled Corner', suits: 1, mult: 1.2, noHints: true, note: 'No hints from here.' },
  { title: 'Deep Box', suits: 1, mult: 1.3, noHints: true, timeSec: 1500, note: 'A generous clock appears.' },
  { title: 'Mastery: Shadow Box', suits: 1, mult: 1.5, mastery: true, noHints: true, moveLimit: 300, note: 'One thread, three hundred moves.' },
  // Web 2 — Midnight Silk: clocks and budgets on one thread
  { title: 'Nightfall', suits: 1, mult: 1.2, timeSec: 1200, note: 'Twenty minutes.' },
  { title: 'Silver Hour', suits: 1, mult: 1.3, timeSec: 1050, note: 'Seventeen and a half.' },
  { title: 'Dark Corners', suits: 1, mult: 1.3, timeSec: 1200, noHints: true, note: 'Unaided, timed.' },
  { title: 'Tight Weave', suits: 1, mult: 1.4, moveLimit: 260, note: 'A real move budget.' },
  { title: 'Moon Budget', suits: 1, mult: 1.4, moveLimit: 240, timeSec: 1200, note: 'Clock and budget together.' },
  { title: 'Blind Silk', suits: 1, mult: 1.5, noUndo: true, note: 'No undo from here.' },
  { title: 'Last Candle', suits: 1, mult: 1.5, noHints: true, timeSec: 900, moveLimit: 260, note: 'Everything tightens.' },
  { title: 'Mastery: Midnight Silk', suits: 1, mult: 1.7, mastery: true, noHints: true, noUndo: true, timeSec: 1200, note: 'One thread, no safety net.' },
  // Web 3 — Jade Loom: a second thread arrives
  { title: 'Second Thread', suits: 2, mult: 1.3, note: 'Two threads. Only same-thread runs travel.' },
  { title: 'Crossed Strands', suits: 2, mult: 1.4, note: 'Mixed stacks block each other.' },
  { title: 'Jade Rhythm', suits: 2, mult: 1.4, timeSec: 1500, note: 'Two threads, timed.' },
  { title: 'Split Focus', suits: 2, mult: 1.5, noHints: true, note: 'Read both threads unaided.' },
  { title: 'Loom Tension', suits: 2, mult: 1.5, moveLimit: 300, note: 'Budget the untangling.' },
  { title: 'Double Deadline', suits: 2, mult: 1.6, timeSec: 1350, moveLimit: 320, note: 'Two constraints.' },
  { title: 'Fine Mesh', suits: 2, mult: 1.6, noUndo: true, note: 'Commit to every move.' },
  { title: 'Mastery: Jade Loom', suits: 2, mult: 1.8, mastery: true, noHints: true, timeSec: 1500, moveLimit: 300, note: 'Two threads, mastered.' },
  // Web 4 — Porcelain Case: restricted tools
  { title: 'Bare Case', suits: 2, mult: 1.5, noHints: true, noUndo: true, note: 'Neither hints nor undo.' },
  { title: 'Cooling Kiln', suits: 2, mult: 1.6, noUndo: true, timeSec: 1350, note: 'Timed, committed.' },
  { title: 'Hairline', suits: 2, mult: 1.6, noHints: true, moveLimit: 280, note: 'A finer budget.' },
  { title: 'Glaze Trial', suits: 2, mult: 1.7, noHints: true, noUndo: true, moveLimit: 300, note: 'Budget without a net.' },
  { title: 'Thin Porcelain', suits: 2, mult: 1.7, noHints: true, noUndo: true, timeSec: 1200, note: 'Everything combined.' },
  { title: 'Fragile', suits: 2, mult: 1.8, noHints: true, noUndo: true, timeSec: 1200, moveLimit: 290, note: 'Handle with care.' },
  { title: 'Ming Minute', suits: 1, mult: 1.8, noHints: true, noUndo: true, timeSec: 600, note: 'One thread, ten minutes, flat out.' },
  { title: 'Mastery: Porcelain Case', suits: 2, mult: 2, mastery: true, noHints: true, noUndo: true, timeSec: 1350, moveLimit: 280, note: 'The case final.' },
  // Web 5 — Ember Thread: the full four-thread loom
  { title: 'Fourth Thread', suits: 4, mult: 1.6, note: 'Four threads. The full loom.' },
  { title: 'First Embers', suits: 4, mult: 1.7, timeSec: 2400, note: 'A long clock for a hard weave.' },
  { title: 'Smoulder', suits: 4, mult: 1.7, noHints: true, note: 'Unaided on four threads.' },
  { title: 'Coal Budget', suits: 4, mult: 1.8, moveLimit: 400, note: 'Four hundred moves.' },
  { title: 'Banked Fire', suits: 4, mult: 1.8, noUndo: true, note: 'Committed on four threads.' },
  { title: 'Furnace', suits: 4, mult: 1.9, timeSec: 2100, moveLimit: 380, note: 'Heat and budget.' },
  { title: 'Wildfire', suits: 4, mult: 2, noHints: true, noUndo: true, timeSec: 2100, note: 'No net on the full loom.' },
  { title: 'Mastery: Ember Thread', suits: 4, mult: 2.2, mastery: true, noHints: true, noUndo: true, timeSec: 2400, moveLimit: 360, note: 'The grand weave.' },
];

function buildJourney() {
  const stages = [];
  JOURNEY_SCRIPT.forEach((script, idx) => {
    const n = idx + 1;
    const theme = THEMES[Math.floor(idx / 8)].id;
    const seed = `journey-${n}`;
    const limits = {};
    if (script.moveLimit) limits.moves = script.moveLimit;
    if (script.timeSec) limits.timeMs = script.timeSec * 1000;
    const mechanics = ['move-runs', 'stock-deals'];
    if (script.suits === 2) mechanics.push('two-threads');
    if (script.suits === 4) mechanics.push('four-threads');
    if (limits.moves) mechanics.push('move-limit');
    if (limits.timeMs) mechanics.push('time-limit');
    if (script.noUndo) mechanics.push('restricted-tools');
    stages.push(makeDef({
      id: `journey-${n}`, seed, title: `${n}. ${script.title}`,
      mode: 'journey', theme, suits: script.suits,
      limits, mechanics,
      par: { moves: script.suits === 1 ? 160 : script.suits === 2 ? 220 : 320, timeMs: (script.timeSec ? script.timeSec * 800 : 900000) },
      assists: { hints: !script.noHints, undo: !script.noUndo },
      ranked: !!script.mastery,
      goals: { type: 'clear-webs', mastery: !!script.mastery, note: script.note },
    }));
  });
  return stages;
}

export const JOURNEY = buildJourney();

// ---------------------------------------------------------------------------
// Daily — one shared seed per UTC day, immutable after publication
// ---------------------------------------------------------------------------

export function dailyForDate(date) {
  const iso = date.toISOString().slice(0, 10); // UTC day boundary
  const seed = `daily-${iso}`;
  const stream = createStream(`daily-params:${iso}`);
  const roll = stream.next();
  const suits = roll < 0.5 ? 1 : roll < 0.85 ? 2 : 4;
  const useClock = stream.next() < 0.35;
  const theme = THEMES[stream.int(0, THEMES.length - 1)].id;
  return makeDef({
    id: seed, seed, title: `Daily — ${iso}`, mode: 'daily', theme, suits,
    limits: useClock ? { timeMs: (900 + stream.int(0, 600)) * 1000 } : {},
    mechanics: ['move-runs', 'stock-deals'].concat(
      suits > 1 ? [`${suits === 2 ? 'two' : 'four'}-threads`] : [],
      useClock ? ['time-limit'] : []),
    par: { moves: suits === 1 ? 160 : suits === 2 ? 220 : 320, timeMs: 1200000 },
    assists: { hints: false, undo: true }, ranked: true,
    goals: { type: 'clear-webs', daily: iso },
  });
}

// ---------------------------------------------------------------------------
// Practice — selectable difficulty, unrated, restart + undo
// ---------------------------------------------------------------------------

export const PRACTICE_DIFFICULTIES = [
  { id: 'single', name: 'Single Thread', suits: 1, note: 'One thread. The classic relax.' },
  { id: 'twin', name: 'Twin Threads', suits: 2, note: 'Two threads. A real tangle.' },
  { id: 'full', name: 'Full Loom', suits: 4, note: 'Four threads. The grand weave.' },
];

export function practiceDef(difficultyId, seed = `practice-${Date.now()}`) {
  const d = PRACTICE_DIFFICULTIES.find((x) => x.id === difficultyId) || PRACTICE_DIFFICULTIES[0];
  return makeDef({
    id: `${d.id}:${seed}`, seed, title: `Practice — ${d.name}`, mode: 'practice',
    theme: 'shadowbox', suits: d.suits,
    mechanics: ['move-runs', 'stock-deals'],
    par: { moves: d.suits === 1 ? 160 : d.suits === 2 ? 220 : 320, timeMs: 1500000 },
    assists: { hints: true, undo: true }, ranked: false,
    goals: { type: 'clear-webs', note: d.note },
  });
}

// ---------------------------------------------------------------------------
// Challenge — constrained goals
// ---------------------------------------------------------------------------

export const CHALLENGES = [
  {
    id: 'silk-sprint', name: 'Silk Sprint',
    note: 'One thread against a ten-minute clock.',
    build() {
      return makeDef({
        id: this.id, seed: 'challenge-sprint', title: this.name, mode: 'challenge',
        theme: 'midnight', suits: 1, limits: { timeMs: 600000 },
        mechanics: ['time-limit'], ranked: true,
        par: { moves: 160, timeMs: 480000 }, goals: { type: 'clear-webs', note: this.note },
        assists: { hints: true, undo: false },
      });
    },
  },
  {
    id: 'move-diet', name: 'Move Diet',
    note: 'One thread in at most two hundred moves.',
    build() {
      return makeDef({
        id: this.id, seed: 'challenge-diet', title: this.name, mode: 'challenge',
        theme: 'porcelain', suits: 1, limits: { moves: 200 },
        mechanics: ['move-limit'], ranked: true,
        par: { moves: 170 }, goals: { type: 'clear-webs', note: this.note },
        assists: { hints: true, undo: false },
      });
    },
  },
  {
    id: 'twin-trial', name: 'Twin Trial',
    note: 'Two threads, no undo. Commit to every move.',
    build() {
      return makeDef({
        id: this.id, seed: 'challenge-twin', title: this.name, mode: 'challenge',
        theme: 'jade', suits: 2,
        mechanics: ['two-threads', 'restricted-tools'], ranked: true,
        par: { moves: 230, timeMs: 1500000 }, goals: { type: 'clear-webs', note: this.note },
        assists: { hints: true, undo: false },
      });
    },
  },
  {
    id: 'grand-loom', name: 'Grand Loom',
    note: 'Four threads. No hints, no undo. The honest table.',
    build() {
      return makeDef({
        id: this.id, seed: 'challenge-grand', title: this.name, mode: 'challenge',
        theme: 'ember', suits: 4,
        mechanics: ['four-threads', 'restricted-tools'], ranked: true,
        par: { moves: 330, timeMs: 2400000 }, goals: { type: 'clear-webs', note: this.note },
        assists: { hints: false, undo: false },
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Achievements (stable lowercase keys, idempotent unlocks)
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { key: 'first_web', name: 'First Web', desc: 'Clear your first King-to-Ace web.' },
  { key: 'mechanic_master', name: 'Full Toolkit', desc: 'Win a round in which you dealt from the stock, used an empty column, and cleared a web.' },
  { key: 'streak_5', name: 'Five-Day Weave', desc: 'Clear webs on five different days.' },
  { key: 'mastery_stage', name: 'Mastery Bound', desc: 'Complete any Mastery stage in the Journey.' },
  { key: 'hundred_webs', name: 'Century of Silk', desc: 'Clear one hundred webs in total.' },
];

// ---------------------------------------------------------------------------
// Offline validators — legality, reachable goals, bounded duration, no locks
// ---------------------------------------------------------------------------

// Greedy simulation with cycle detection. Proves the content loads, plays,
// and never hangs or reaches an impossible mandatory state; records outcome
// and difficulty signals as metrics. Winning is a metric, not a requirement:
// honest shuffled deals are not all solvable, and ranked seeds are immutable.
export function validateContent(def) {
  const report = { id: def.id, ok: true, errors: [], metrics: {} };
  try {
    let state = createGame(def);
    checkStructure(state, def, report);
    if (report.errors.length) { report.ok = false; return report; }

    // Authored lessons replay their scripted steps and must end in a win.
    if (def.tutorial?.steps) {
      state = playScriptedLesson(def, state, report);
      if (report.errors.length) { report.ok = false; return report; }
    }

    const seen = new Set([hashState(state)]);
    let steps = 0;
    let branchSum = 0;
    const budget = 4000;
    while (state.status === 'active' && steps < budget) {
      const legal = listLegalMoves(state);
      branchSum += legal.length;
      let moved = false;
      // Hint order, then the rest: take the first move to an unseen state.
      const hint = getHint(state);
      const ordered = hint ? [hint, ...legal.filter((m) => m !== hint)] : legal;
      for (const m of ordered) {
        const r = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs + 4000, type: 'move', from: m.from, idx: m.idx, to: m.to });
        if (r.error) { report.errors.push(`move rejected: ${r.error}`); break; }
        const h = hashState(r.state);
        if (seen.has(h)) continue;
        seen.add(h);
        state = r.state;
        moved = true;
        break;
      }
      if (report.errors.length) break;
      if (!moved) {
        if (canDeal(state)) {
          const r = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs + 4000, type: 'deal' });
          if (r.error) { report.errors.push(`deal rejected: ${r.error}`); break; }
          const h = hashState(r.state);
          if (seen.has(h)) { report.metrics.cycled = true; break; }
          seen.add(h);
          state = r.state;
        } else {
          // No unseen moves and no deal: either terminal (engine flags it)
          // or every option loops. Both are playable, neither is a hang.
          report.metrics.cycled = state.status === 'active';
          break;
        }
      }
      steps++;
    }
    report.metrics.outcome = state.status === 'active' ? 'open' : state.status;
    report.metrics.terminalReason = state.terminalReason;
    report.metrics.solutionDepth = steps;
    report.metrics.avgBranching = steps ? +(branchSum / steps).toFixed(2) : 0;
    report.metrics.webs = state.foundations;
    if (steps >= budget) report.metrics.budgetExceeded = true; // long game ≠ defect
    if (state.status === 'active' && state.stock.length === 0 && listLegalMoves(state).length === 0) {
      report.errors.push('soft-lock: no moves, no stock, but not terminal');
    }
    if (!Number.isFinite(state.score.total)) report.errors.push('NaN score');
  } catch (e) {
    report.errors.push(`exception: ${e.message}`);
  }
  if (report.errors.length) report.ok = false;
  return report;
}

function checkStructure(state, def, report) {
  if (state.cols.length !== COLUMN_COUNT) report.errors.push('bad column count');
  if (def.layout) return; // authored layouts define their own contents
  const total = state.cols.reduce((n, c) => n + c.length, 0) +
    state.stock.reduce((n, p) => n + p.length, 0);
  if (total !== 104) report.errors.push(`deck size ${total} != 104`);
  if (state.stock.length !== 5 || state.stock.some((p) => p.length !== COLUMN_COUNT)) {
    report.errors.push('bad stock packets');
  }
  for (let c = 0; c < 4; c++) if (state.cols[c].length !== 6) report.errors.push(`column ${c} size`);
  for (let c = 4; c < COLUMN_COUNT; c++) if (state.cols[c].length !== 5) report.errors.push(`column ${c} size`);
  const seen = new Map();
  for (const pile of [...state.cols, ...state.stock]) {
    for (const cd of pile) {
      const key = `${cd.r}:${cd.s}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  const copies = 8 / state.suits;
  for (const [key, n] of seen) {
    if (n !== copies) report.errors.push(`card ${key} appears ${n} times (want ${copies})`);
  }
}

// Replays a lesson's required steps, then cascades with the hint API to the
// authored win. Lessons must terminate in 'won'.
function playScriptedLesson(def, state, report) {
  let cmdId = state.nextCmdId;
  const doMove = (from, to, idx = null) => {
    let pick = idx;
    if (pick == null) {
      // Choose the index the legality API itself approves for this column pair.
      const m = listLegalMoves(state).find((x) => x.from === from && x.to === to);
      if (!m) { report.errors.push(`lesson move ${from}->${to} has no legal index`); return state; }
      pick = m.idx;
    }
    const r = applyCommand(state, { id: cmdId, at: state.elapsedMs + 3000, type: 'move', from, idx: pick, to });
    cmdId = r.state.nextCmdId;
    if (r.error) { report.errors.push(`lesson move rejected: ${r.error}`); return state; }
    if (r.events.some((e) => e.type === 'invalid')) {
      report.errors.push(`lesson move invalid: ${r.events.find((e) => e.type === 'invalid').reason}`);
      return state;
    }
    return r.state;
  };
  for (const step of def.tutorial.steps) {
    const req = step.require;
    if (state.status !== 'active') break;
    if (req.type === 'move') state = doMove(req.from, req.to, req.idx ?? null);
    else if (req.type === 'any-move') {
      const h = getHint(state);
      if (!h) { report.errors.push('lesson step has no legal move'); break; }
      state = doMove(h.from, h.to, h.idx);
    } else if (req.type === 'any-deal') {
      const r = applyCommand(state, { id: cmdId, at: state.elapsedMs + 3000, type: 'deal' });
      cmdId = r.state.nextCmdId;
      if (r.error) { report.errors.push(`lesson deal rejected: ${r.error}`); break; }
      state = r.state;
    }
  }
  // Scripted steps done: let the hint API finish the authored cascade.
  let guard = 0;
  while (state.status === 'active' && guard++ < 300) {
    const h = getHint(state);
    if (!h) {
      if (canDeal(state)) {
        const r = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs + 3000, type: 'deal' });
        if (r.error) break;
        state = r.state;
        continue;
      }
      break;
    }
    const r = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs + 3000, type: 'move', from: h.from, idx: h.idx, to: h.to });
    if (r.error) break;
    state = r.state;
  }
  if (state.status !== 'won') report.errors.push(`lesson did not reach its win (ended ${state.status}:${state.terminalReason || 'open'})`);
  report.metrics.lesson = true;
  return state;
}

// Bulk validation (used by tests and the authoritative script).
export function validateAll() {
  const reports = [];
  for (const def of [...LESSONS, ...JOURNEY, ...CHALLENGES.map((c) => c.build())]) {
    reports.push(validateContent(def));
  }
  for (let d = 0; d < 14; d++) {
    const date = new Date(Date.UTC(2026, 0, 1 + d));
    reports.push(validateContent(dailyForDate(date)));
  }
  for (const diff of PRACTICE_DIFFICULTIES) {
    for (let i = 0; i < 3; i++) reports.push(validateContent(practiceDef(diff.id, `val-${diff.id}-${i}`)));
  }
  return reports;
}

export { hashSeed };
