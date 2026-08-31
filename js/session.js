// Eight Webs — session controller.
// Owns the game-state machine and every transition's reason; routes all rules
// changes through validated commands; keeps undo snapshots, the replay
// envelope, tutorial gating, and the authoritative session clock.

import {
  createGame, applyCommand, serialize, deserialize, hashState, replay,
  checkMove, getHint, canDeal, isMovableRun, COLUMN_COUNT,
} from './rules.js';

export const MACHINE_STATES = [
  'boot', 'title', 'profile-ready', 'mode-select', 'preparing',
  'tutorial', 'countdown', 'active', 'paused', 'reconnecting',
  'resolving', 'results', 'progression',
];

const AUTOSAVE_KEY = 'eightwebs:autosave';

export class Session {
  constructor(platform, emit) {
    this.platform = platform;   // persistence + hosted adapter
    this.emit = emit;           // (event) => void  UI/render/audio sink
    this.machine = 'boot';
    this.machineReason = 'init';
    this.def = null;
    this.state = null;          // rules state (immutable snapshots)
    this.selection = null;      // { from, idx } — UI-level picked run
    this.undoStack = [];        // serialized snapshots (practice/journey/learn)
    this.commands = [];         // ordered applied commands (replay log)
    this.checkpoints = [];      // periodic state hashes
    this.sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    this.startStamp = 0;        // perf clock when round went active
    this.pauseAccum = 0;
    this.pauseStart = 0;
    this.tutorialStep = 0;
    this.toolTallies = { deal: 0, empty: 0, run: 0 }; // achievement tracking
    this.onTransition = null;
  }

  transition(to, reason) {
    if (!MACHINE_STATES.includes(to)) throw new Error(`unknown machine state ${to}`);
    const from = this.machine;
    this.machine = to;
    this.machineReason = reason;
    this.onTransition?.(from, to, reason);
    this.emit({ type: 'machine', from, to, reason });
  }

  // --- clock ---------------------------------------------------------------
  nowMs() {
    if (this.machine !== 'active' && this.machine !== 'resolving') return this.state?.elapsedMs ?? 0;
    return this.pauseAccum + (performance.now() - this.startStamp);
  }

  // --- round lifecycle -----------------------------------------------------
  startRound(def) {
    this.def = def;
    this.state = createGame(def);
    this.selection = null;
    this.undoStack = [];
    this.commands = [];
    this.checkpoints = [{ after: 0, hash: hashState(this.state) }];
    this.tutorialStep = 0;
    this.toolTallies = { deal: 0, empty: 0, run: 0 };
    this.pauseAccum = 0;
    this.transition(def.mode === 'learn' ? 'tutorial' : 'countdown', `start:${def.id}`);
    this.emit({ type: 'round', def, state: this.state });
  }

  beginActive() {
    this.startStamp = performance.now();
    this.pauseAccum = this.state?.elapsedMs ?? 0;
    this.transition('active', 'countdown-complete');
  }

  pause(reason = 'user') {
    if (this.machine !== 'active' && this.machine !== 'tutorial') return;
    this.pauseAccum = this.nowMs();
    this.pauseStart = performance.now();
    this.transition('paused', reason);
    this.saveSnapshot();
  }

  resume() {
    if (this.machine !== 'paused' && this.machine !== 'reconnecting') return;
    this.startStamp = performance.now();
    this.transition('active', `resume:${this.machineReason}`);
  }

  // Backgrounding pauses solo simulation; on return we rebuild from the last
  // safe snapshot and summarize what happened while away.
  background() {
    if (this.machine === 'active' || this.machine === 'tutorial') this.pause('background');
  }

  // --- commands ------------------------------------------------------------
  dispatch(cmd) {
    if (!this.state) return { error: 'no-round' };
    const withMeta = { id: this.state.nextCmdId, at: Math.floor(this.nowMs()), ...cmd };
    const r = applyCommand(this.state, withMeta);
    if (r.error) return r;
    this.state = r.state;
    this.commands.push(withMeta);
    if (this.commands.length % 5 === 0 || this.state.status !== 'active') {
      this.checkpoints.push({ after: withMeta.id, hash: hashState(this.state) });
    }
    for (const e of r.events || []) {
      if (e.type === 'deal') this.toolTallies.deal += 1;
      if (e.type === 'move' && e.toEmpty) this.toolTallies.empty += 1;
      if (e.type === 'run-complete') this.toolTallies.run += 1;
      this.emit({ type: 'game-event', event: e, state: this.state });
    }
    if (this.state.status !== 'active') {
      this.transition('resolving', this.state.terminalReason);
      this.saveResult();
      this.clearAutosave();
      this.emit({ type: 'round-end', state: this.state, def: this.def });
    }
    return r;
  }

  inRound() {
    return this.state && this.state.status === 'active' &&
      (this.machine === 'active' || this.machine === 'tutorial');
  }

  // Pick a run (tap a face-up card), commit onto a column, or cancel.
  tapCard(col, idx) {
    if (!this.inRound()) return { error: 'not-active' };
    const column = this.state.cols[col];
    if (!column || idx < 0 || idx >= column.length) return { error: 'out-of-bounds' };
    if (!column[idx].u) return { error: 'face-down' }; // hidden cards are inert

    if (this.selection === null) {
      if (!isMovableRun(this.state, col, idx)) {
        // Tapping inside a mixed stack lifts the movable run beneath the tap.
        const lift = this.movableStart(col, idx);
        if (lift === null) {
          this.emit({ type: 'invalid', reason: 'broken-run', from: col, idx, to: null });
          return { error: 'broken-run' };
        }
        this.selection = { from: col, idx: lift };
      } else {
        this.selection = { from: col, idx };
      }
      this.emit({ type: 'select', selection: this.selection });
      return { ok: true };
    }
    if (this.selection.from === col) {
      // Tapping the source column again cancels (or re-picks another run in it).
      if (this.selection.idx === idx) {
        this.selection = null;
        this.emit({ type: 'select', selection: null });
        return { ok: true };
      }
      this.selection = null;
      return this.tapCard(col, idx);
    }
    return this.commitMove(col);
  }

  // Tap an empty column (or a column header pad) to drop the picked run there.
  tapColumnPad(col) {
    if (!this.inRound()) return { error: 'not-active' };
    if (this.selection === null) return { error: 'no-selection' };
    if (this.state.cols[col].length > 0) return { error: 'not-empty' };
    return this.commitMove(col);
  }

  movableStart(col, idx) {
    const column = this.state.cols[col];
    for (let i = idx; i < column.length; i++) {
      if (isMovableRun(this.state, col, i)) return i;
    }
    return null;
  }

  commitMove(to) {
    const { from, idx } = this.selection;
    const action = { type: 'move', from, idx, to };
    const gate = this.lessonGate(action);
    if (gate) {
      this.emit({ type: 'lesson-blocked', message: gate });
      this.selection = null;
      this.emit({ type: 'select', selection: null });
      return { error: 'lesson-gated' };
    }
    const legality = checkMove(this.state, from, idx, to);
    this.pushUndo();
    const r = this.dispatch(action);
    this.selection = null;
    this.emit({ type: 'select', selection: null });
    if (!legality.ok) {
      this.emit({ type: 'invalid', reason: legality.reason, from, idx, to });
      return { error: legality.reason };
    }
    if (!r.error) this.advanceLesson({ ...action, state: this.state });
    return r;
  }

  deal() {
    if (!this.inRound()) return { error: 'not-active' };
    const gate = this.lessonGate({ type: 'deal' });
    if (gate) {
      this.emit({ type: 'lesson-blocked', message: gate });
      return { error: 'lesson-gated' };
    }
    if (this.state.stock.length === 0) return { error: 'stock-empty' };
    if (!canDeal(this.state)) {
      // Still routed through rules so the violation is recorded.
      const r = this.dispatch({ type: 'deal' });
      this.emit({ type: 'invalid', reason: 'empty-column' });
      return r;
    }
    this.pushUndo();
    const r = this.dispatch({ type: 'deal' });
    if (!r.error) this.advanceLesson({ type: 'deal' });
    return r;
  }

  giveUp() {
    if (!this.state || this.state.status !== 'active') return { error: 'round-over' };
    return this.dispatch({ type: 'giveUp' });
  }

  hint() {
    if (!this.def?.assists?.hints) return { error: 'hints-disabled' };
    const h = getHint(this.state);
    if (h) this.emit({ type: 'hint', ...h });
    else this.emit({ type: 'hint', none: true, canDeal: canDeal(this.state) });
    return h;
  }

  // Columns that legally accept the current selection (target preview).
  legalTargets() {
    if (!this.state || this.selection === null) return [];
    const { from, idx } = this.selection;
    const out = [];
    for (let to = 0; to < COLUMN_COUNT; to++) {
      if (checkMove(this.state, from, idx, to).ok) out.push(to);
    }
    return out;
  }

  legalTargetPreview(to) {
    if (this.selection === null) return null;
    return checkMove(this.state, this.selection.from, this.selection.idx, to);
  }

  // --- undo ----------------------------------------------------------------
  undoAllowed() {
    return !!this.def?.assists?.undo && this.undoStack.length > 0 &&
      this.state?.status === 'active' &&
      (this.machine === 'active' || this.machine === 'tutorial');
  }

  pushUndo() {
    if (!this.def?.assists?.undo) return;
    this.undoStack.push(serialize(this.state));
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  undo() {
    if (!this.undoAllowed()) return { error: 'undo-unavailable' };
    const undos = this.state.undos + 1;
    this.state = deserialize(this.undoStack.pop());
    this.state.undos = undos; // no-undo scoring survives the restore
    this.selection = null;
    this.commands.push({ id: -1, at: Math.floor(this.nowMs()), type: 'undo-marker' });
    this.emit({ type: 'undo', state: this.state });
    return { ok: true };
  }

  // --- lessons ---------------------------------------------------------------
  currentLessonStep() {
    const steps = this.def?.tutorial?.steps;
    if (!steps || this.tutorialStep >= steps.length) return null;
    return steps[this.tutorialStep];
  }

  lessonGate(action) {
    const step = this.currentLessonStep();
    if (!step) return null;
    const req = step.require;
    if (req.type === 'any-move' && action.type === 'move') return null;
    if (req.type === 'any-deal' && action.type === 'deal') return null;
    if (req.type === 'move' && action.type === 'move' &&
        req.from === action.from && req.to === action.to) return null;
    return 'Follow the lesson: ' + step.text;
  }

  advanceLesson(action) {
    const step = this.currentLessonStep();
    if (!step) return;
    this.tutorialStep += 1;
    const next = this.currentLessonStep();
    this.emit({ type: 'lesson-step', index: this.tutorialStep, step: next, done: !next });
  }

  // --- persistence / replay --------------------------------------------------
  saveSnapshot() {
    if (!this.state || this.state.status !== 'active') return;
    const snap = {
      v: 1, def: this.def, state: serialize(this.state),
      commands: this.commands.filter((c) => c.id > 0),
      savedAt: Date.now(), sessionId: this.sessionId,
    };
    this.platform.saveLocal(AUTOSAVE_KEY, snap);
  }

  // Reconnect from the durable snapshot, not from cached client memory.
  restoreSnapshot() {
    const snap = this.platform.loadLocal(AUTOSAVE_KEY);
    if (!snap) return null;
    try {
      this.def = snap.def;
      this.state = deserialize(snap.state);
      this.commands = snap.commands || [];
      this.sessionId = snap.sessionId || this.sessionId;
      this.selection = null;
      this.undoStack = [];
      const awayMs = Date.now() - (snap.savedAt || Date.now());
      this.transition('paused', 'reconnect');
      this.emit({ type: 'round', def: this.def, state: this.state });
      this.emit({
        type: 'while-away',
        summary: `Round restored. You were away ${Math.max(1, Math.round(awayMs / 60000))} min; ` +
          `${this.state.foundations}/${this.state.webGoal} webs cleared, score ${this.state.score.total}.`,
      });
      return snap;
    } catch {
      this.clearAutosave();
      return null;
    }
  }

  hasSnapshot() {
    return !!this.platform.loadLocal(AUTOSAVE_KEY);
  }

  clearAutosave() {
    this.platform.saveLocal(AUTOSAVE_KEY, null);
  }

  replayEnvelope() {
    return {
      schema: 1,
      build: this.def?.rulesV ?? 1,
      contentV: this.def?.v ?? 1,
      contentId: this.def?.id ?? null,
      seed: this.def?.seed,
      init: {
        seed: this.def.seed, suits: this.def.suits, layout: this.def.layout,
        webGoal: this.def.webGoal, limits: this.def.limits, par: this.def.par,
        mode: this.def.mode, contentId: this.def.id, mechanics: this.def.mechanics,
      },
      initHash: this.checkpoints[0]?.hash,
      timestampOffset: this.platform.serverOffsetMs?.() ?? 0,
      commands: this.commands.filter((c) => c.id > 0),
      checkpoints: this.checkpoints,
      result: this.state
        ? {
            status: this.state.status, reason: this.state.terminalReason,
            seed: this.def?.seed, contentId: this.def?.id, mode: this.def?.mode,
            score: { ...this.state.score }, moves: this.state.moves,
            invalid: this.state.invalid, elapsedMs: this.state.elapsedMs,
            foundations: this.state.foundations, dealsUsed: this.state.dealsUsed,
            undos: this.state.undos, sessionId: this.sessionId,
          }
        : null,
    };
  }

  verifyOwnReplay() {
    const env = this.replayEnvelope();
    const r = replay(env);
    return r.ok && r.finalHash === this.checkpoints[this.checkpoints.length - 1]?.hash;
  }

  saveResult() {
    const result = {
      contentId: this.def.id, mode: this.def.mode, seed: this.def.seed,
      status: this.state.status, reason: this.state.terminalReason,
      score: { ...this.state.score }, moves: this.state.moves,
      invalid: this.state.invalid, elapsedMs: this.state.elapsedMs,
      foundations: this.state.foundations, dealsUsed: this.state.dealsUsed,
      undos: this.state.undos, flips: this.state.flips,
      suits: this.state.suits, toolTallies: { ...this.toolTallies },
      sessionId: this.sessionId, at: Date.now(),
      assists: this.def.assists, rulesV: this.def.rulesV, contentV: this.def.v,
      durationMs: this.state.elapsedMs,
    };
    this.platform.recordResult(result, this.replayEnvelope());
  }
}
