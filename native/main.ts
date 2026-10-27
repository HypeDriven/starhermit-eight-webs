// Eight Webs on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), content (js/content.js),
// the session with its undo, lesson gating, autosave and replay envelope
// (js/session.js) and the table layout (js/layout.js) are the browser
// build's, unchanged in what they decide; this module is what js/main.js and
// js/ui.js did around them — the screen flow (title → modes → Learn /
// Journey / Daily / Practice / Challenges / Scores / Help → the round with
// its 3-2-1 countdown ⇄ pause → results → retry / next / title), the round
// lifecycle with its saved snapshot (Resume saved round on the title), the
// selection model (tap a face-up card to lift its run, tap a destination,
// or drag the run; the keyboard cursor), Deal, Undo, Hint, the clock with
// its one-minute warning and the authoritative time-out, the event
// presentation (a sound with its caption, an announcement, a toast and the
// table's sparks per rules event), progression and achievements, the
// round history and the device's daily board, posting ranked totals through
// score-script.js and the lifecycle (a hidden window pauses the round and
// saves the snapshot, as the browser build's visibilitychange did). The
// screens and HUD are drawn by screens.ts (starhermit:ui), the table by
// render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): the session's clock
// (js/session.js clock) reads them, and the countdown, the hint's 3.5 s,
// toasts and captions wait on the same steps, so play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Session, clock } from "../js/session.js";
import { ACHIEVEMENTS, JOURNEY, LESSONS, SUITS, dailyForDate, getTheme } from "../js/content.js";
import { rankLabel } from "../js/rules.js";
import { computeLayout } from "../js/layout.js";
import * as audio from "./audio.ts";
import { N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTheme, initStyles } from "./style.ts";

// -- the shapes this client reads ------------------------------------------------------------
export interface Card { r: number; s: number; u: number }
export interface Score { base: number; movePenalty: number; runs: number; time: number; noUndo: number; total: number }
export interface State {
  cols: Card[][]; stock: Card[][]; foundations: number; webGoal: number; status: string; terminalReason: string | null;
  elapsedMs: number; moves: number; invalid: number; undos: number; score: Score;
  limits: { moves: number | null; timeMs: number | null };
}
export interface Def {
  id: string; title: string; mode: string; seed: string; suits: number; ranked: boolean;
  limits: { moves?: number; timeMs?: number }; assists: { hints: boolean; undo: boolean };
  goals?: { note?: string; mastery?: boolean }; tutorial?: { steps: { text: string }[] };
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface Layout { cw: number; ch: number; gap: number; topBar: number; cols: Rect[][]; pads: Rect[]; stock: Rect[]; foundations: Rect[]; W: number; H: number }
export interface HistoryRow { contentId: string; mode: string; status: string; at: number; score: Score; moves: number; foundations: number }
interface SessionApi {
  machine: string; def: Def | null; state: State | null; selection: { from: number; idx: number } | null; toolTallies: { deal: number; empty: number; run: number };
  startRound(def: Def): void; beginActive(): void; pause(reason?: string): void; resume(): void; background(): void;
  dispatch(cmd: Record<string, unknown>): { error?: string }; inRound(): boolean; tapCard(col: number, idx: number): { error?: string };
  tapColumnPad(col: number): { error?: string }; commitMove(to: number): { error?: string }; deal(): { error?: string } | undefined;
  giveUp(): { error?: string }; hint(): { from: number; idx: number; to: number; none?: boolean; canDeal?: boolean; error?: string } | null;
  legalTargets(): number[]; undoAllowed(): boolean; undo(): { error?: string }; currentLessonStep(): { text: string } | null;
  saveSnapshot(): void; restoreSnapshot(): unknown; hasSnapshot(): boolean; nowMs(): number;
}
type Ev = Record<string, unknown> & { type: string };

export type Screen = "title" | "modes" | "journey" | "lessons" | "challenges" | "practice" | "help" | "scores" | "play";
export type Modal = "pause" | "settings" | "results";
export interface Results {
  def: Def; st: State; won: boolean; headlineKey: string; newly: string[];
}

const STEP_MS = 1000 / 60;
let fixedMs = 0;
clock.now = () => fixedMs;
const now = (): number => fixedMs / 1000;

export const app = {
  screen: "title" as Screen,
  openedFrame: 0,
  focusNext: null as string | null,
  modal: null as Modal | null,
  modalOpened: 0,
  /** Where Help's Back goes: the pause dialog of the round, else the mode list. */
  helpFromRound: false,
  restored: false,
  countdown: null as { n: number; left: number } | null,
  toasts: [] as { text: string; until: number }[],
  caption: null as { text: string; until: number } | null,
  focusCard: null as { col: number; idx: number } | null,
  hintMove: null as { from: number; idx: number; to: number } | null,
  hintLeft: 0,
  results: null as Results | null,
  lb: null as null | "posting" | platform.Posted,
  seedText: "",
  /** The table's layout this frame (playfield logical px) and the playfield's window position. */
  layout: null as Layout | null,
  board: { x: 0, y: 0, w: 1, h: 1 },
  /** A finger has touched the screen (wider card strips, as the browser build's pointer: coarse). */
  coarse: false,
  /** The run being dragged (a press on a card that moved past 12 px). */
  drag: null as { col: number; idx: number; x: number; y: number; active: boolean } | null,
};
export const options = platform.options;
export const session = new Session(platform.local, (e: Ev) => onEvent(e)) as unknown as SessionApi;
export let history: HistoryRow[] = [];
let timeWarned = false;

// ------------------------------------------------------------------ helpers
export function announce(text: string): void { if (text) ui.announce(String(text).slice(0, 500)); }
/** ui.js toast(): 4 s by default. */
export function toast(text: string, ms = 4000): void {
  app.toasts.push({ text, until: now() + ms / 1000 });
  if (app.toasts.length > 3) app.toasts.shift();
}
export function haptic(ms = 12): void { if (options.haptics) { try { vibrate(ms); } catch { /* no motor */ } } }
export const theme = (): render.Theme => getTheme(options.theme) as render.Theme;
const CVD_SUIT_COLORS: Record<string, string[]> = {
  // Color-vision-safe palettes; shape/label cues always accompany color.
  deuter: ["#0072b2", "#e69f00", "#009e73", "#cc79a7"],
  protan: ["#0072b2", "#f0e442", "#009e73", "#d55e00"],
  tritan: ["#0173b2", "#de8f05", "#029e73", "#cc78bc"],
};
/** ui.js themedSuits: the threads in the chosen colour-vision palette. */
export function suits(): { name: string; glyph: string; color: string }[] {
  const cvd = CVD_SUIT_COLORS[options.cvd];
  return SUITS.map((s: { name: string; glyph: string; color: string }, i: number) => ({ ...s, color: cvd ? cvd[i]! : s.color }));
}
/** Display title of a round definition (content keeps the US-English titles). */
export function defTitle(def: Def | null): string {
  const t = String(def?.title || "");
  let m = /^(\d+)\. (.+)$/.exec(t);
  if (m) return `${m[1]}. ${T(m[2]!)}`;
  m = /^Daily — (.+)$/.exec(t);
  if (m) return T("Daily — {date}", { date: m[1]! });
  m = /^Practice — (.+)$/.exec(t);
  if (m) return T("Practice — {name}", { name: T(m[1]!) });
  return T(t);
}
export const STATUS_TEXT: Record<string, string> = { won: N("WON"), lost: N("LOST"), aborted: N("ABANDONED") };
export const TERMINAL_TEXT: Record<string, string> = {
  "all-runs": N("all webs cleared"), "move-limit": N("move limit reached"), "time-limit": N("time ran out"),
  "no-moves": N("no moves left"), "gave-up": N("gave up"),
};
const REASON_TEXT: Record<string, string> = {
  "same-column": N("that is the same column"),
  "face-down": N("that card is face-down"),
  "broken-run": N("only same-thread descending runs travel together"),
  "rank-mismatch": N("a run rests only on the next rank up"),
  "empty-column": N("you cannot deal while a column is empty"),
  "round-over": N("the round is over"),
  "out-of-bounds": N("off the table"),
  "stock-empty": N("the stock is empty"),
  "hints-disabled": N("hints are disabled for this round"),
};
export function reasonText(reason: string): string { return REASON_TEXT[reason] ? T(REASON_TEXT[reason]!) : reason; }
export function objectiveText(): string {
  const st = session.state;
  if (!st) return "";
  return T(st.webGoal > 1 ? N("Clear {goal} webs. {done}/{goal} done.") : N("Clear {goal} web. {done}/{goal} done."), { goal: st.webGoal, done: st.foundations });
}
export function fmtClock(ms: number): string {
  const mm = Math.floor(ms / 60000), ss = Math.floor((ms % 60000) / 1000);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
/** The top bar's clock: the elapsed time, or the time left on a clocked round. */
export function clockText(): { text: string; timed: boolean; urgent: boolean } {
  const st = session.state;
  if (!st) return { text: "", timed: false, urgent: false };
  const ms = session.nowMs();
  if (st.limits.timeMs != null) {
    const left = Math.max(0, st.limits.timeMs - ms);
    return { text: fmtClock(left), timed: true, urgent: left < 60000 };
  }
  return { text: fmtClock(ms), timed: false, urgent: false };
}

// ------------------------------------------------------------------ navigation
export function show(screen: Screen, focus: string | null = null): void {
  app.screen = screen;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  app.drag = null;
  ui.setFocus(null);
  render.setActive(screen === "play");
  if (screen !== "play") render.clearFx();
}
const modalStack: Modal[] = [];
export function openModal(m: Modal): void {
  modalStack.push(m);
  app.modal = m;
  app.modalOpened = frame().frame;
  ui.setFocus(null);
}
/** A dialog closed: back to the one under it. */
export function closeModal(): void {
  modalStack.pop();
  app.modal = modalStack[modalStack.length - 1] ?? null;
  app.modalOpened = frame().frame;
  ui.setFocus(null);
}
function clearModals(): void { modalStack.length = 0; app.modal = null; }
export function goTitle(): void { clearModals(); show("title", "btn-play"); }
export function openHelp(): void {
  app.helpFromRound = app.screen === "play" && !!session.state;
  clearModals();
  show("help", "btn-back");
}
export function helpBack(): void {
  if (app.helpFromRound && session.state) { show("play"); showPause(); }
  else show("modes", "mode-0");
}

// ------------------------------------------------------------------ rounds (ui.js startRound …)
export function startRound(def: Def): void {
  clearModals();
  app.hintMove = null;
  app.focusCard = null;
  app.results = null;
  app.lb = null;
  app.restored = false;
  timeWarned = false;
  render.clearFx();
  session.startRound(def);
  show("play");
  if (def.mode === "learn") showLessonStep();
  else countdown();
}
function countdown(): void {
  if (preferences().reducedMotion) { session.beginActive(); return; }
  app.countdown = { n: 3, left: 700 };
  audio.cue("tick");
}
function showLessonStep(): void {
  const step = session.currentLessonStep();
  if (step) { announce(T(step.text)); toast(T(step.text)); }
}
export function startDaily(): void {
  const day = platform.todayUTC();
  startRound(dailyForDate(new Date(day + "T12:00:00Z")) as Def);
}
export function resumeSaved(): void {
  const snap = session.restoreSnapshot();
  if (!snap) return;
  app.hintMove = null;
  app.focusCard = null;
  app.results = null;
  timeWarned = false;
  show("play");
  showPause(true);
}

// ------------------------------------------------------------------ play controls
export function tapCard(col: number, idx: number): void {
  if (!session.inRound()) return;
  app.hintMove = null;
  const before = session.selection;
  const r = session.tapCard(col, idx);
  if (!r.error && before === null && session.selection) audio.cue("select");
  haptic(8);
  afterAction();
}
export function tapPad(col: number): void {
  const r = session.tapColumnPad(col);
  if (r.error === "not-empty" || r.error === "no-selection") return;
  afterAction();
}
export function doDeal(): void {
  if (!session.inRound()) return;
  app.hintMove = null;
  const r = session.deal();
  if (r?.error) { toast(reasonText(r.error), 2500); announce(reasonText(r.error)); }
  afterAction();
}
export function doUndo(): void {
  const r = session.undo();
  if (!r.error) { audio.cue("undo"); announce(T("Move undone.")); }
}
export function doHint(): void {
  const h = session.hint();
  const st = session.state;
  if (h && !h.error && !h.none && st) {
    app.hintMove = { from: h.from, idx: h.idx, to: h.to };
    app.hintLeft = 3500;
    audio.cue("hint");
    const c = st.cols[h.from]![h.idx]!;
    const suit = suits()[c.s]!;
    announce(T("Hint: move the {rank} of {suit} from column {from} to column {to}.", { rank: rankLabel(c.r), suit: T(suit.name), from: h.from + 1, to: h.to + 1 }));
  } else if (h?.none) {
    announce(T(h.canDeal ? N("No moves — deal from the stock.") : N("No legal moves remain.")));
    toast(T(h.canDeal ? N("No moves available — deal from the stock.") : N("No legal moves remain.")));
  } else if (h?.error) {
    toast(reasonText(h.error), 2500);
  }
}
function afterAction(): void {
  if (session.state?.status === "active") session.saveSnapshot();
}
/** Escape / B: set a lifted run down, else pause. */
export function escPressed(): void {
  if (session.selection) {
    session.selection = null;
    app.hintMove = null;
    audio.cue("deselect");
  } else if (session.inRound() || session.machine === "paused") {
    showPause();
  }
}
/** The keyboard cursor (ui.js moveFocus): arrows walk the face-up cards. */
export function moveFocus(dx: number, dy: number): void {
  const st = session.state;
  if (!st) return;
  if (!app.focusCard) {
    for (let c = 0; c < 10; c++) if (st.cols[c]!.length) { app.focusCard = { col: c, idx: st.cols[c]!.length - 1 }; break; }
    if (!app.focusCard) app.focusCard = { col: 0, idx: 0 };
  } else if (dx !== 0) {
    // While a run is lifted the cursor also stops on empty columns, so the keyboard can drop it there
    // (the browser build's cursor skipped them; its empty-column pads were reached with Tab).
    let c = app.focusCard.col;
    for (let k = 0; k < 10; k++) {
      c = (c + dx + 10) % 10;
      if (st.cols[c]!.length || session.selection) { app.focusCard = { col: c, idx: Math.max(0, Math.min(app.focusCard.idx, st.cols[c]!.length - 1)) }; break; }
    }
  } else {
    const col = st.cols[app.focusCard.col]!;
    app.focusCard.idx = Math.max(0, Math.min(col.length - 1, app.focusCard.idx + (dy > 0 ? 1 : -1)));
  }
  const f = app.focusCard;
  const cd = st.cols[f.col]?.[f.idx];
  if (cd) announce(cardLabel(f.col, f.idx));
  else if (!st.cols[f.col]?.length) announce(T("Column {n} (empty)", { n: f.col + 1 }));
}
export function confirmFocus(): void {
  if (!app.focusCard) { moveFocus(0, 0); return; }
  const st = session.state;
  if (st && !st.cols[app.focusCard.col]!.length) { tapPad(app.focusCard.col); return; }
  tapCard(app.focusCard.col, app.focusCard.idx);
}
/** A card's spoken name (ui.js aria-label). */
export function cardLabel(col: number, idx: number, st: State = session.state!): string {
  const cd = st.cols[col]?.[idx];
  if (!cd) return "";
  if (!cd.u) return T("Column {n}: face-down card", { n: col + 1 });
  const suit = suits()[cd.s]!;
  const runLen = st.cols[col]!.length - idx;
  return T("Column {n}: {rank} of {suit}", { n: col + 1, rank: rankLabel(cd.r), suit: T(suit.name) }) + (runLen > 1 ? T(", run of {n}", { n: runLen }) : "");
}

// ------------------------------------------------------------------ pause
export function showPause(restored = false): void {
  if (session.inRound() || session.machine === "paused") session.pause("user");
  audio.cue("pause");
  app.restored = restored;
  clearModals();
  openModal("pause");
}
export function resumeRound(): void {
  clearModals();
  session.resume();
}
export function restartRound(): void { if (session.def) startRound(session.def); }
export function giveUp(): void { clearModals(); session.giveUp(); }
export function leaveRound(): void {
  clearModals();
  session.pause("leave");
  session.saveSnapshot();
  show("title", "btn-play");
}

// ------------------------------------------------------------------ session events (ui.js onEvent)
function onEvent(e: Ev): void {
  switch (e.type) {
    case "game-event": {
      const ev = e.event as Ev & { reason?: string; col?: number; to?: number };
      const st = e.state as State;
      if (ev.type === "move") audio.cue("move");
      else if (ev.type === "flip") audio.cue("flip");
      else if (ev.type === "deal") audio.cue("deal");
      else if (ev.type === "run-complete") {
        audio.cue("run-complete");
        announce(T("Web complete! {done} of {goal}.", { done: st.foundations, goal: st.webGoal }));
      } else if (ev.type === "invalid") {
        audio.cue("invalid");
        announce(T("Not legal: {reason}.", { reason: reasonText(String(ev.reason)) }));
        toast(T("Not legal: {reason}.", { reason: reasonText(String(ev.reason)) }), 2500);
      } else if (ev.type === "win") audio.cue("win");
      else if (ev.type === "lose") audio.cue("lose");
      render.eventFx(ev, app.layout);
      break;
    }
    case "invalid":
      audio.cue("invalid");
      toast(T("Not legal: {reason}.", { reason: reasonText(String(e.reason)) }), 2500);
      announce(T("Not legal: {reason}.", { reason: reasonText(String(e.reason)) }));
      break;
    case "lesson-step": {
      const step = e.step as { text: string } | null;
      if (step) { audio.cue("lesson-step"); toast(T(step.text), 6000); announce(T(step.text)); }
      else toast(T("Lesson complete when the web clears!"), 3000);
      break;
    }
    case "lesson-blocked": {
      const msg = e.stepText ? T("Follow the lesson: {step}", { step: T(String(e.stepText)) }) : String(e.message);
      toast(msg, 3000); announce(msg); break;
    }
    case "while-away": {
      const a = e.away as Record<string, number> | null;
      const msg = a ? T("Round restored. You were away {min} min; {webs}/{goal} webs cleared, score {score}.", a) : String(e.summary);
      toast(msg, 6000); announce(msg); break;
    }
    case "round-end": queueMicrotask(onRoundEnd); break;
    default:
  }
}

function onRoundEnd(): void {
  const st = session.state, def = session.def;
  if (!st || !def) return;
  const progress = platform.progress();
  // Progression + achievements (idempotent).
  const won = st.status === "won";
  const newly: string[] = [];
  const at = platform.nowMs();
  const grant = (key: string): void => { if (!progress.achievements[key]) { progress.achievements[key] = at; newly.push(key); } };
  if (won) {
    if (def.mode === "journey") progress.journey[def.id] = { score: st.score.total, at };
    if (def.goals?.mastery) { progress.mastery[def.id] = true; grant("mastery_stage"); }
    if (def.mode === "learn") progress.lessonsDone[def.id] = true;
    const day = platform.todayUTC();
    if (!progress.daysPlayed.includes(day)) progress.daysPlayed.push(day);
    if (progress.daysPlayed.length >= 5) grant("streak_5");
    if (st.foundations > 0) grant("first_web");
  }
  progress.websCleared += st.foundations;
  if (progress.websCleared >= 100) grant("hundred_webs");
  const t = session.toolTallies;
  if (t.deal > 0 && t.empty > 0 && t.run > 0 && won) grant("mechanic_master");
  const best = progress.bests[def.id];
  if (won && (!best || st.score.total > best)) progress.bests[def.id] = st.score.total;
  history.push({ contentId: def.id, mode: def.mode, status: st.status, at, score: { ...st.score }, moves: st.moves, foundations: st.foundations });
  if (history.length > 50) history.shift();
  platform.saveProgress();
  platform.local.saveLocal(platform.HISTORY_KEY, history);

  const headlineKey = won ? N("All webs cleared!") : st.status === "aborted" ? N("Round abandoned") : N("The weave holds…");
  app.results = { def, st, won, headlineKey, newly };
  app.hintMove = null;
  postToLeaderboard(def, st);
  clearModals();
  openModal("results");
  if (newly.length) {
    achievementAt = fixedMs + 700; // after the win/lose sting
    announce(T("Achievement unlocked: {names}", {
      names: newly.map((k) => { const a = ACHIEVEMENTS.find((x: { key: string }) => x.key === k); return a ? T(a.name) : k; }).join(", "),
    }));
  }
  announce(T("{headline} Final score {total}.", { headline: T(headlineKey), total: st.score.total }));
}
let achievementAt = -1;
export function headline(x: Results): string { return T(x.headlineKey); }

/** Signed-in ranked rounds that finished (won or lost, not given up): post the total, show the rank. */
function postToLeaderboard(def: Def, st: State): void {
  app.lb = null;
  if (!def.ranked || st.status === "aborted" || !platform.signedIn()) return;
  app.lb = "posting";
  const results = app.results;
  void platform.postLeaderboard(st.score.total).then((p) => { if (app.results === results) app.lb = p; });
}
export function leaderboardLine(): string | null {
  const lb = app.lb;
  if (!lb) return null;
  if (lb === "posting") return T("Posting score to the leaderboard…");
  if (!lb.posted) return T("Score not posted to the leaderboard.");
  return lb.rank ? T("Leaderboard rank: #{rank}", { rank: lb.rank }) : T("Score posted to the leaderboard.");
}
export function nextRecommended(): { label: string; act: () => void } {
  const def = app.results?.def ?? session.def;
  if (def?.mode === "journey") {
    const idx = JOURNEY.findIndex((j: Def) => j.id === def.id);
    if (idx >= 0 && idx + 1 < JOURNEY.length) return { label: N("Next stage"), act: () => startRound(JOURNEY[idx + 1] as Def) };
  }
  if (def?.mode === "learn") {
    const idx = LESSONS.findIndex((l: Def) => l.id === def.id);
    if (idx >= 0 && idx + 1 < LESSONS.length) return { label: N("Next lesson"), act: () => startRound(LESSONS[idx + 1] as Def) };
  }
  return { label: N("Journey"), act: () => { clearModals(); show("journey", "stage-0"); } };
}
export function resultsRetry(): void { const d = app.results?.def; if (d) startRound(d); }
export function resultsTitle(): void { app.results = null; goTitle(); }

// ------------------------------------------------------------------ account
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(T("Invite link copied to the clipboard.")); }
  catch { toast(T("Could not copy — invite link: {link}", { link })); }
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function statusLine(): string | null {
  if (!platform.signedIn()) return null;
  const st = platform.syncState();
  return T("Playing as {name}", { name: platform.displayName() || "…" }) + " · " +
    T(st === "synced" ? N("progress synced") : st === "saving" ? N("saving…") : N("cloud sync unavailable"));
}

// ------------------------------------------------------------------ input
function playing(): boolean { return app.screen === "play" && !app.modal && !!session.state; }
onAction((e) => {
  if (!e.pressed) return;
  if (e.source !== "pointer" && e.source !== "touch") pointerPress = false;
  const fresh = frame().frame !== app.openedFrame && frame().frame !== app.modalOpened;
  if (app.modal) return; // dialogs take their own keys
  if (app.screen === "help") { if (e.action === "pause" && fresh && !ui.capturingKeys()) helpBack(); return; }
  if (app.screen !== "play") {
    // Escape on a list screen goes back, as its Back button.
    if (e.action === "pause" && fresh && !ui.capturingKeys()) {
      if (app.screen === "modes") goTitle();
      else if (app.screen !== "title") show("modes", "mode-0");
    }
    return;
  }
  if (!playing() || app.countdown) return;
  switch (e.action) {
    case "pause": if (fresh) escPressed(); break;
    case "deal": doDeal(); break;
    case "hint": doHint(); break;
    case "undo": doUndo(); break;
    case "left": ui.setFocus(null); moveFocus(-1, 0); break;
    case "right": ui.setFocus(null); moveFocus(1, 0); break;
    case "up": ui.setFocus(null); moveFocus(0, -1); break;
    case "down": ui.setFocus(null); moveFocus(0, 1); break;
    case "confirm": if (!ui.focused()) confirmFocus(); break;
    default:
  }
});

// Drags (ui.js onCardPointerDown / onPointerMove / onPointerUp): a press on a
// face-up card that moves past 12 px lifts its run (if none is lifted) and
// drops it on the column under the release; dropped on its own column it is
// set down quietly; over no column it stays lifted. Taps are the card
// widgets' own (screens.ts). Presses are queued and decided after the
// frame's UI is built, when the layout is this frame's.
let lastTouch = -1e9;
const queued: { kind: "down" | "move" | "up" | "cancel"; x: number; y: number }[] = [];
/** The press that began a drag: its card's click is not a tap. */
export let dragged = false;
/** The last press on the table was a pointer's or a finger's (Hold to drag ignores their taps, not Enter's). */
export let pointerPress = false;
function toBoard(x: number, y: number): { x: number; y: number } {
  const sc = ui.preferences().scale;
  return { x: x / sc - app.board.x, y: y / sc - app.board.y };
}
/** The column whose pad (its cards' extent) holds a board point, else null. */
export function columnAt(bx: number, by: number): number | null {
  const L = app.layout;
  if (!L) return null;
  for (let c = 0; c < L.pads.length; c++) {
    const p = L.pads[c]!;
    if (bx >= p.x && bx <= p.x + p.w && by >= p.y && by <= p.y + p.h) return c;
  }
  return null;
}
/** The card under a board point (topmost), or null. */
function cardAt(bx: number, by: number): { col: number; idx: number } | null {
  const L = app.layout, st = session.state;
  if (!L || !st) return null;
  for (let c = 0; c < L.cols.length; c++) {
    const rects = L.cols[c]!;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i]!;
      if (bx >= r.x && bx <= r.x + r.w && by >= r.y && by <= r.y + r.h) return { col: c, idx: i };
    }
  }
  return null;
}
function boardInput(): void {
  for (const q of queued.splice(0)) {
    const p = toBoard(q.x, q.y);
    if (q.kind === "down") {
      dragged = false;
      pointerPress = true;
      app.drag = null;
      if (!playing() || !session.inRound()) continue;
      const hit = cardAt(p.x, p.y);
      if (!hit || !session.state!.cols[hit.col]![hit.idx]!.u) continue;
      app.drag = { col: hit.col, idx: hit.idx, x: p.x, y: p.y, active: false };
    } else if (q.kind === "move") {
      const d = app.drag;
      if (!d || d.active) continue;
      if (Math.hypot(p.x - d.x, p.y - d.y) > 12) {
        if (session.selection === null) {
          const r = session.tapCard(d.col, d.idx);
          if (!r.error && session.selection) audio.cue("select");
        }
        if (session.selection) { d.active = true; dragged = true; }
      }
    } else {
      const d = app.drag;
      app.drag = null;
      // The release's click (this frame's UI, already built) was the drag's; later taps are taps.
      dragged = false;
      if (!d || !d.active || q.kind === "cancel") continue;
      const col = columnAt(p.x, p.y);
      if (col == null) continue; // over no column: the run stays lifted to re-aim
      if (col === session.selection?.from) { session.selection = null; audio.cue("deselect"); }
      else if (session.selection) session.commitMove(col);
      afterAction();
    }
  }
}
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  queued.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onPointerMove((x, y) => { if (app.drag && now() - lastTouch >= 0.6) queued.push({ kind: "move", x, y }); });
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = now();
  app.coarse = true;
  if (e.phase === "start") queued.push({ kind: "down", x: e.x, y: e.y });
  else if (e.phase === "move") queued.push({ kind: "move", x: e.x, y: e.y });
  else if (e.phase === "end") queued.push({ kind: "up", x: e.x, y: e.y });
  else queued.push({ kind: "cancel", x: e.x, y: e.y });
});

// ------------------------------------------------------------------ layout of the table
/** The table's layout for the playfield (logical px) this frame; also places the 3D table. */
export function layoutTable(x: number, y: number, w: number, h: number, phone: boolean): Layout | null {
  const st = session.state;
  const sc = ui.preferences().scale;
  const f = frame();
  app.board = { x, y, w, h };
  render.setPlayfield(x, y, w, h, f.width / sc, f.height / sc);
  app.layout = st ? computeLayout(st, w, h, { coarse: app.coarse || phone }) as Layout : null;
  return app.layout;
}

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
function applyOptions(): void {
  const t = theme();
  applyTheme(t);
  render.setTheme(t);
}
platform.onOptionsChange(applyOptions);
platform.onAdopt(() => toast(T("progress synced")));
audio.onCaption((text) => { app.caption = { text: T(text), until: now() + 1.6 }; });
audio.setIntensity(() => { const st = session.state; return st ? st.foundations / Math.max(1, st.webGoal) : 0; });

onStart(() => {
  setFixedRate(60);
  initStyles(theme());
  platform.initPlatform();
  const h = platform.local.loadLocal(platform.HISTORY_KEY);
  history = Array.isArray(h) ? h as HistoryRow[] : [];
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  applyOptions();
  render.setActive(false);
  goTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(T("cloud sync unavailable")));
let hidden = false;
onSuspend(() => {
  hidden = true;
  audio.setSuspended(true);
  // Backgrounding pauses the round and keeps its snapshot (ui.js visibilitychange → session.background).
  session.background();
  if (app.screen === "play" && session.machine === "paused" && !app.modal && !app.results) openModal("pause");
  platform.flush();
});
onResume(() => { hidden = false; audio.setSuspended(false); });
onQuit(() => { if (session.state?.status === "active") session.saveSnapshot(); platform.flush(); });

onFixedUpdate(() => {
  if (hidden) return;
  fixedMs += STEP_MS;
  render.tick(STEP_MS);
  if (achievementAt >= 0 && fixedMs >= achievementAt) { achievementAt = -1; audio.cue("achievement"); }
  const cd = app.countdown;
  if (cd && !app.modal) {
    cd.left -= STEP_MS;
    if (cd.left <= 0) {
      cd.n -= 1;
      if (cd.n <= 0) {
        app.countdown = null;
        session.beginActive();
        announce(T("Round started.") + " " + objectiveText());
      } else { cd.left += 700; audio.cue("tick"); }
    }
    return;
  }
  if (app.hintMove) { app.hintLeft -= STEP_MS; if (app.hintLeft <= 0) app.hintMove = null; }
  // The clock (ui.js updateClock): the one-minute warning, and a time-out between inputs lands through the rules.
  const st = session.state;
  if (st && st.status === "active" && session.machine === "active" && st.limits.timeMs != null) {
    const left = st.limits.timeMs - session.nowMs();
    if (left < 60000 && left > 0 && !timeWarned) { timeWarned = true; audio.cue("time-warning"); announce(T("One minute left.")); }
    if (left <= 0) session.dispatch({ type: "note" });
  }
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until >= t);
  if (app.caption && app.caption.until < t) app.caption = null;
});
onRender(() => {
  drawScreens();
  boardInput();
  render.update(frameDt);
});
