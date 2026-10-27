// Writes the keyboard-driven play scripts in tests/native/ from the rules:
// the moves are planned in node on the shipped js/session.js and js/rules.js
// (the lessons' scripted steps, a greedy weave for the rest) and turned into
// the arrow / Enter presses the game's card cursor (native/main.ts
// moveFocus / confirmFocus, modelled here exactly) needs to lift each run and
// drop it on its column, with D for the stock.
//   node tools/gen-plays.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '../js/session.js';
import { CHALLENGES, JOURNEY, LESSONS } from '../js/content.js';
import { canDeal, getHint, hashState, listLegalMoves } from '../js/rules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fakePlatform = { saveLocal() {}, loadLocal() { return null; }, serverOffsetMs: () => 0, recordResult() {} };

/** A round in node with the game's card cursor, recording the play-script lines that drive it. */
class Driver {
  constructor(def) {
    this.s = new Session(fakePlatform, () => {});
    this.s.startRound(def);
    if (def.mode !== 'learn') this.s.beginActive();
    this.focus = null;
    this.lines = [];
  }
  key(code) { this.lines.push(`key ${code} 1`, 'frames 2'); }
  // native/main.ts moveFocus
  move(dx, dy) {
    const st = this.s.state;
    if (!this.focus) {
      for (let c = 0; c < 10; c++) if (st.cols[c].length) { this.focus = { col: c, idx: st.cols[c].length - 1 }; break; }
      if (!this.focus) this.focus = { col: 0, idx: 0 };
    } else if (dx !== 0) {
      let c = this.focus.col;
      for (let k = 0; k < 10; k++) {
        c = (c + dx + 10) % 10;
        if (st.cols[c].length || this.s.selection) { this.focus = { col: c, idx: Math.max(0, Math.min(this.focus.idx, st.cols[c].length - 1)) }; break; }
      }
    } else {
      const col = st.cols[this.focus.col];
      this.focus.idx = Math.max(0, Math.min(col.length - 1, this.focus.idx + (dy > 0 ? 1 : -1)));
    }
  }
  press(dir) {
    const [dx, dy, code] = { left: [-1, 0, 'ArrowLeft'], right: [1, 0, 'ArrowRight'], up: [0, -1, 'ArrowUp'], down: [0, 1, 'ArrowDown'] }[dir];
    this.move(dx, dy);
    this.key(code);
  }
  // native/main.ts confirmFocus
  confirm() {
    this.key('Enter');
    if (!this.focus) { this.move(0, 0); return; }
    if (!this.s.state.cols[this.focus.col].length) { this.s.tapColumnPad(this.focus.col); return; }
    this.s.tapCard(this.focus.col, this.focus.idx);
  }
  /** Walks the cursor to a column (the shorter way round) and, when given, a card in it. */
  goto(col, idx = null) {
    if (!this.focus) this.press('down');
    const steps = (dir) => {
      const save = this.focus && { ...this.focus };
      let n = 0;
      while (this.focus.col !== col && n < 11) { this.move(dir === 'right' ? 1 : -1, 0); n++; }
      this.focus = save;
      return this.focus.col === col ? 0 : n;
    };
    if (this.focus.col !== col) {
      const r = steps('right'), l = steps('left');
      const dir = r <= l ? 'right' : 'left';
      for (let k = 0; k < 11 && this.focus.col !== col; k++) this.press(dir);
    }
    if (idx != null) {
      for (let k = 0; k < 120 && this.focus.idx !== idx; k++) this.press(this.focus.idx > idx ? 'up' : 'down');
    }
    if (this.focus.col !== col || (idx != null && this.focus.idx !== idx)) throw new Error(`cursor cannot reach ${col}/${idx}`);
  }
  /** Lifts the run at (from, idx) and drops it on `to`. */
  moveRun(m) {
    this.goto(m.from, m.idx);
    this.confirm();
    const sel = this.s.selection;
    if (!sel || sel.from !== m.from || sel.idx !== m.idx) throw new Error(`lift failed at ${m.from}/${m.idx}`);
    const dest = this.s.state.cols[m.to].length;
    this.goto(m.to, dest ? dest - 1 : null); // a face-down card takes no drop: aim at the column's top card
    const before = this.s.state.moves;
    this.confirm();
    if (this.s.state.moves !== before + 1) throw new Error(`drop failed ${m.from}/${m.idx}->${m.to} focus=${JSON.stringify(this.focus)} sel=${JSON.stringify(this.s.selection)} moves=${before}->${this.s.state.moves} cols=${this.s.state.cols.map((c) => c.length)}`);
  }
  deal() { this.key('KeyD'); this.s.deal(); }
}

/** A lesson's scripted steps (the largest run that satisfies each), then hints until the web clears. */
function playLesson(d, def) {
  for (const step of def.tutorial.steps) {
    if (d.s.state.status !== 'active') break;
    const req = step.require;
    if (req.type === 'any-deal') { d.deal(); continue; }
    const legal = listLegalMoves(d.s.state);
    const m = req.type === 'move'
      ? legal.filter((x) => x.from === req.from && x.to === req.to).sort((a, b) => a.idx - b.idx)[0]
      : getHint(d.s.state);
    if (!m) throw new Error(`${def.id}: no move for step "${step.text}"`);
    d.moveRun(m);
  }
  for (let k = 0; k < 20 && d.s.state.status === 'active'; k++) d.moveRun(getHint(d.s.state));
  if (d.s.state.status !== 'won') throw new Error(`${def.id} not won`);
}

/** Greedy weave (js/content.js validateContent's): hint order to an unseen state, else deal, else any move. */
function weave(d, maxMoves) {
  const seen = new Set([hashState(d.s.state)]);
  let n = 0;
  while (d.s.state.status === 'active' && n < maxMoves) {
    const st = d.s.state;
    const legal = listLegalMoves(st);
    const hint = getHint(st);
    const ordered = hint ? [hint, ...legal.filter((m) => m !== hint)] : legal;
    let pick = null;
    for (const m of ordered) {
      const probe = new Session(fakePlatform, () => {});
      probe.def = d.s.def; probe.state = st; probe.machine = 'active';
      probe.selection = { from: m.from, idx: m.idx };
      probe.commitMove(m.to);
      const h = hashState(probe.state);
      if (!seen.has(h)) { seen.add(h); pick = m; break; }
    }
    if (!pick && canDeal(st)) { d.deal(); seen.add(hashState(d.s.state)); n++; continue; }
    if (!pick) pick = ordered[0];
    if (!pick) break;
    d.moveRun(pick);
    n++;
  }
}

const header = (title) => [`# ${title}`, '# Generated by tools/gen-plays.mjs from the rules (keyboard card cursor); regenerate after rule or cursor changes.'];
const out = {};

// -- every lesson, chained through the results' Next lesson ------------------------------------
{
  const lines = [...header('Learn: all five lessons by keyboard to their results, chained by Next lesson; the Learn list then ticks them.'),
    'until 300 Eight Webs', 'frames 120', 'click =Learn', 'until 60 Build Down', 'frames 10', 'click =Start', 'until 60 Cards stack downward', 'frames 10'];
  LESSONS.forEach((def, i) => {
    const d = new Driver(def);
    playLesson(d, def);
    lines.push(`# lesson ${i + 1}: ${def.title}`, ...d.lines, 'until 200 All webs cleared!', 'frames 30', `save lesson-${i + 1}-results`);
    if (i + 1 < LESSONS.length) {
      const first = LESSONS[i + 1].tutorial.steps[0].text.split(/[.:—]/)[0];
      lines.push('click =Next lesson', `until 120 ${first}`, 'frames 10');
    } else lines.push('click =Title', 'until 120 Journey 0/40', 'frames 10', 'click =Learn', 'until 60 Threads Travel Together', 'frames 30', 'save lessons-done');
  });
  out['learn-lessons.play'] = lines;
}

// -- a Move Diet challenge played to its move budget ----------------------------------------------
{
  const c = CHALLENGES.find((x) => x.id === 'move-diet');
  const def = c.build();
  const d = new Driver(def);
  weave(d, 400);
  if (d.s.state.terminalReason !== 'move-limit') throw new Error(`move diet ended ${d.s.state.status}/${d.s.state.terminalReason}`);
  out['challenge-move-diet.play'] = [...header('Challenge: Move Diet played by keyboard (lifts, drops and deals) to its 200-move budget and the results.'),
    'until 300 Eight Webs', 'frames 120', 'click =Play', 'until 60 Choose a mode', 'frames 10', 'click =Challenge', 'until 60 Move Diet',
    'frames 10', 'click =Start #2', 'until 60 Move Diet', 'frames 160', 'save move-diet-start', ...d.lines,
    'until 300 The weave holds', 'frames 30', 'expect move limit reached', 'save move-diet-results', 'click =Title', 'until 120 Eight Webs'];
}

// -- Journey stage 1: moves, a deal, hint, undo, pause, give up --------------------------------------
{
  const def = JOURNEY[0];
  const d = new Driver(def);
  weave(d, 12);
  d.lines.push('key KeyH 1', 'frames 10', 'save journey-hint');
  d.deal();
  d.lines.push('frames 10', 'key KeyU 1', 'frames 10');
  out['journey-stage.play'] = [...header('Journey stage 1: twelve moves by keyboard, Hint, a deal and its Undo, the pause menu, Give up and the results.'),
    'until 300 Eight Webs', 'frames 120', 'click =Journey', 'until 60 First Threads', 'frames 10', 'click =Start', 'until 60 First Threads', 'frames 160',
    'save journey-start', ...d.lines, 'save journey-played', 'key Escape 1', 'until 60 Leave to title', 'frames 10', 'save journey-paused', 'click =Give up',
    'until 120 Round abandoned', 'frames 30', 'expect gave up', 'save journey-results', 'click =Title', 'until 120 Eight Webs'];
}

for (const [name, lines] of Object.entries(out)) {
  writeFileSync(join(root, 'tests/native', name), lines.join('\n') + '\n');
  console.log(`tests/native/${name}: ${lines.length} lines`);
}
