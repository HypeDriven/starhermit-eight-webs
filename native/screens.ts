// The browser build's DOM shell (index.html + js/ui.js) as starhermit:ui,
// built every frame: the title (key art, tagline, Play, Daily Challenge /
// Journey / Learn / Scores / Help / Settings, Resume saved round, the
// progress line, the account line with sign-in and invite), the mode grid,
// the Learn, Journey, Challenges and Practice lists of set-up cards (rules,
// clock, assists and ranked flag before Start; Practice's custom seed), Scores
// & History with this device's daily board, How to play, the round (the top
// bar with the pause menu, the round's title and clock; the Objective and
// status rails beside the table on wide windows; the Undo / Hint / Deal
// tray; the card layer over the 3D table — face-up and face-down cards, the
// stock packets, the cleared webs and the empty-column pads, with the lifted
// run, the legal targets, the hint's dashes and the keyboard cursor), the
// 3-2-1 countdown, the dialogs (pause with the settings, settings, results),
// the toasts and the sound captions. The browser's media queries are layouts
// picked by the window's logical size: wide (≥ 1024 px: rails beside the
// table), compact (rails hidden, as the old CSS hid them), short landscape
// (≤ 500 px tall: slimmer bars, no key art); the left-handed option reverses
// the tray.
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { ACHIEVEMENTS, CHALLENGES, JOURNEY, LESSONS, PRACTICE_DIFFICULTIES, THEMES, practiceDef } from "../js/content.js";
import { faceDownCount, rankLabel } from "../js/rules.js";
import { N, T, currentLocale } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  STATUS_TEXT, TERMINAL_TEXT, app, cardLabel, clockText, closeModal, copyInvite, defTitle, doDeal, doHint, doUndo, dragged, giveUp,
  goTitle, headline, helpBack, history, layoutTable, leaderboardLine, leaveRound, nextRecommended, objectiveText, openHelp, openModal,
  options, pointerPress, restartRound, resultsRetry, resultsTitle, resumeRound, resumeSaved, session, show, showPause, signIn, startDaily,
  startRound, statusLine, suits, tapCard, tapPad, theme, type Def, type Layout as TableLayout, type Rect as BoxRect,
} from "./main.ts";
import { mix } from "./style.ts";
import { OffscreenCanvas } from "starhermit:canvas";
import { CanvasTexture, SRGBColorSpace, type Texture } from "starhermit:scene";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; wide: boolean; phone: boolean; short: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const short = lw > lh && lh <= 500;
  return { lw, lh, sc, ox: sa.left / sc, oy: sa.top / sc, wide: lw >= 1024 && !short, phone: lw < 560, short };
}
const lastHeight = new Map<string, number>();
const pr = (): ui.UiPreferences => ui.preferences();
function textWidth(text: string, style: string | readonly string[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: typeof style === "string" ? style : [...style] }).width / pr().scale;
}
const buttonWidth = (text: string, style: readonly string[]): number => textWidth(text, style, "button") + 4;

interface Btn { id: string; text: string; style?: string[]; disabled?: boolean; act: () => void; width?: number; tip?: string }
const PLAIN = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 32);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  let u = ui.style(...style, s).id(b.id);
  if (b.tip) u = u.tooltip(b.tip);
  if (u.button(b.text, opts)) b.act();
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, align: "start" | "center" | "end" = "center", gap = 8): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? PLAIN));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, b.width ?? (bw(b) >= width ? width : null));
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / pr().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
/** Cuts a single line to fit `width` with an ellipsis (CSS text-overflow). */
function ellipsize(text: string, width: number, cls: string): string {
  if (textWidth(text, cls) <= width) return text;
  let s = text;
  while (s.length > 1 && textWidth(s + "…", cls) > width) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}
const keyName = (action: string): string => bindingLabel(action, "keyboard") || "—";
const keyLabel = (action: string): string => keyName(action).replace(/^Arrow /, "").replace(/^Escape$/, "Esc");

/** An image cover-fitted into a box with rounded corners (the felt colour while it loads). */
function art(id: string, path: string, w: number, h: number, radius: number, shadow = true): void {
  const t = theme();
  ui.id(id).widget("", {
    role: "none", size: { width: w, height: h },
    draw: (r) => draw.box(r.x, r.y, r.width, r.height, {
      background: [{ image: path, size: "cover" }, t.felt], radius, border: { width: 1, color: t.rule },
      ...(shadow ? { shadow: { y: 10, blur: 30, color: "#00000040" } } : {}),
    }),
  });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const t = theme();
  if (app.screen !== "play") draw.rect(0, 0, f.width, f.height, t.paper);
  switch (app.screen) {
    case "title": titleScreen(L); break;
    case "modes": modesScreen(L); break;
    case "lessons": lessonsScreen(L); break;
    case "journey": journeyScreen(L); break;
    case "challenges": challengesScreen(L); break;
    case "practice": practiceScreen(L); break;
    case "scores": scoresScreen(L); break;
    case "help": helpScreen(L); break;
    case "play": playScreen(L); break;
  }
  dialogs(L);
  if (app.countdown && app.screen === "play") countdownOverlay(L);
  toasts(L);
  caption(L);
  if (app.focusNext && !app.modal) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

/** A full-window menu page: a centred column up to `maxW` wide that scrolls when taller, with a pinned footer. */
function page(key: string, L: Layout, maxW: number, build: (w: number) => void, footer: ((w: number) => void) | null = null, center = true): void {
  const pad = L.phone ? 16 : 24;
  const pw = Math.min(maxW, L.lw * 0.92, L.lw - 2 * pad);
  let footH = 0;
  if (footer) {
    const fr = ui.place(`foot-${key}`, { anchor: "bottom-start", x: 0, y: 0 }, () => ui.column(`foot-${key}-in`, () => footer(pw), { width: L.lw, align: "center", padding: { top: 10, bottom: 12 } }), { width: L.lw });
    footH = fr.height / L.sc;
  }
  const avail = Math.max(80, L.lh - footH);
  const h = lastHeight.get(key) ?? 0;
  const scroll = h > avail;
  ui.place(`page-${key}`, { anchor: "top-start", x: 0, y: 0 }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => build(pw - (scroll ? 12 : 0)), { width: pw, spacing: 14.4, align: "center", padding: { top: pad, bottom: footer ? 8 : pad } });
      lastHeight.set(key, r.height / L.sc);
    };
    const fresh = frame().frame - app.openedFrame <= 5;
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: L.lw, height: avail }, () => ui.column(`${key}-sc`, body, { width: L.lw - 12, align: "center" }), fresh ? { scrollTo: { top: 0 } } : undefined);
    else ui.column(`${key}-outer`, body, { width: L.lw, height: avail, align: "center", justify: center ? "center" : "start" });
  }, { width: L.lw });
}
const backBtn = (to: () => void): Btn => ({ id: "btn-back", text: T("← Back"), act: to });
const backFooter = (to: () => void) => (w: number): void => flow("back-row", [backBtn(to)], w);

// ------------------------------------------------------------------ title
function titleScreen(L: Layout): void {
  const progress = platform.progress();
  page("title", L, 720, (w) => {
    ui.style("title-h1", { text: { size: Math.max(32, Math.min(L.lw * 0.07, 54.4)) } }).id("title-h1").heading("Eight Webs");
    if (!L.short) {
      const aw = Math.min(640, w);
      const ah = Math.min(aw * 9 / 16, L.lh * 0.3, 300);
      art("title-art", "assets/key-art.webp", aw, ah, 12);
    }
    para(T("Weave descending runs of silk thread. Clear all eight webs."), w, "tagline", "tagline", true);
    button({ id: "btn-play", text: T("▶ Play"), style: ["btn-primary", "btn-big"], act: () => show("modes", "mode-0") });
    flow("title-row", [
      { id: "btn-daily", text: T("Daily Challenge"), act: startDaily },
      { id: "btn-journey", text: T("Journey"), act: () => show("journey", "stage-0") },
      { id: "btn-learn", text: T("Learn"), act: () => show("lessons", "lesson-0") },
      { id: "btn-scores", text: T("Scores"), act: () => show("scores", "btn-back") },
      { id: "btn-help", text: T("Help"), act: openHelp },
      { id: "btn-settings", text: T("Settings"), act: () => openModal("settings") },
    ], w);
    if (session.hasSnapshot()) button({ id: "btn-resume", text: T("Resume saved round"), style: ["btn-accent"], act: resumeSaved });
    para(T("Journey {done}/{total} · Webs cleared {webs}", { done: Object.keys(progress.journey).length, total: JOURNEY.length, webs: progress.websCleared }), w, "progress-line", "title-progress", true);
    const status = statusLine();
    const plat: Btn[] = [];
    if (!platform.signedIn()) plat.push({ id: "btn-signin", text: T("Sign in with StarHermit"), act: signIn });
    if (platform.inviteLink()) plat.push({ id: "btn-invite", text: T("Invite a friend"), act: copyInvite });
    if (status) para(status, w, "progress-line", "title-status", true);
    if (plat.length) flow("title-platform", plat, w);
  });
}

// ------------------------------------------------------------------ modes and lists
function modesScreen(L: Layout): void {
  const modes: [string, string, () => void][] = [
    [N("Learn"), N("Five short lessons. One rule at a time."), () => show("lessons", "lesson-0")],
    [N("Journey"), N("Forty authored stages across five webs."), () => show("journey", "stage-0")],
    [N("Daily"), N("One shared seed per UTC day. Ranked."), startDaily],
    [N("Practice"), N("Pick a difficulty. Unrated, free undo."), () => show("practice", "practice-0")],
    [N("Challenge"), N("Move budgets, clocks, restricted tools."), () => show("challenges", "challenge-0")],
    [N("Scores"), N("Your history and the boards."), () => show("scores", "btn-back")],
  ];
  page("modes", L, 720, (w) => {
    ui.style("h1").id("modes-h").heading(T("Choose a mode"));
    const gap = 11.2;
    const cols = Math.max(1, Math.floor((w + gap) / (180 + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    ui.column("mode-grid", () => {
      for (let i = 0; i < modes.length; i += cols) {
        ui.row(`mg-${i}`, () => {
          for (let j = i; j < Math.min(modes.length, i + cols); j++) {
            const [name, desc, act] = modes[j]!;
            const inner = cw - 34;
            if (ui.style("mode-card", { width: cw }).id(`mode-${j}`).button(T(name), {
              content: () => ui.column(`mc-${j}`, () => { para(T(name), inner, "strong"); para(T(desc), inner, "card-sub"); }, { spacing: 4, align: "start", width: inner }),
            })) act();
          }
        }, { spacing: gap, align: "stretch" });
      }
    }, { spacing: gap, width: w });
    flow("modes-back", [backBtn(goTitle)], w);
  });
}

/** ui.js setupCard: the round's title, threads and clock, assists and ranked flag, its note, Start. */
function setupCard(id: string, def: Def, w: number, badge: string | null, locked: boolean, onStart: () => void): void {
  const durMin = def.limits.timeMs ? Math.round(def.limits.timeMs / 60000) : null;
  const parts = [T(def.suits > 1 ? N("{n} threads") : N("{n} thread"), { n: def.suits }), durMin ? T("~{n} min clock", { n: durMin }) : T("untimed")];
  if (def.limits.moves) parts.push(T("≤{n} moves", { n: def.limits.moves }));
  const assists = T("Assists: {hints}, {undo} · {ranked}", {
    hints: T(def.assists.hints ? N("hints") : N("no hints")), undo: T(def.assists.undo ? N("undo") : N("no undo")), ranked: T(def.ranked ? N("Ranked") : N("Unrated")),
  });
  const inner = w - 30;
  const t = theme();
  const badgeW = (): void => {
    if (!badge) return;
    ui.widget("", {
      role: "none", size: { width: 25.6, height: 25.6 },
      draw: (r) => {
        draw.circle(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, locked ? mix(t.accent, t.panel, 0.5) : t.accent);
        draw.text(badge, r.x + r.width / 2, r.y + r.height / 2 - 7.4 * pr().scale, { size: 12.8 * pr().scale, weight: "700", color: "#ffffff", align: "center" });
      },
    });
  };
  ui.column(`${id}-col`, () => {
    ui.row(`${id}-head`, () => { para(defTitle(def), inner - 34, "strong"); ui.spacer(); badgeW(); }, { width: inner, align: "start" });
    para(parts.join(" · "), inner, "small");
    para(assists, inner, "small");
    if (def.goals?.note) para(T(def.goals.note), inner, "note");
    ui.column(`${id}-btn`, () => button({ id, text: T("Start"), style: ["btn-primary"], disabled: locked, act: onStart }), { padding: { top: 5 } });
  }, { style: locked ? "setup-locked" : "setup-card", width: w, spacing: 2.4 });
}
function listScreen(key: string, L: Layout, title: string, build: (w: number) => void): void {
  page(key, L, 640, (w) => {
    ui.style("h1").id(`${key}-h`).heading(title);
    ui.column(`${key}-list`, () => build(w), { spacing: 8, width: w });
  }, backFooter(() => show("modes", "mode-0")), false);
}
function lessonsScreen(L: Layout): void {
  const progress = platform.progress();
  listScreen("lessons", L, T("Learn"), (w) => LESSONS.forEach((def: Def, i: number) => {
    const done = progress.lessonsDone[def.id];
    setupCard(`lesson-${i}`, def, w, done ? "✓" : String(i + 1), false, () => startRound(def));
  }));
}
function journeyScreen(L: Layout): void {
  const progress = platform.progress();
  listScreen("journey", L, T("Journey"), (w) => JOURNEY.forEach((def: Def, i: number) => {
    const done = progress.journey[def.id];
    const prevDone = i === 0 || !!progress.journey[(JOURNEY[i - 1] as Def).id];
    setupCard(`stage-${i}`, def, w, done ? "✓" : def.goals?.mastery ? "★" : String(i + 1), !prevDone, () => startRound(def));
  }));
}
function challengesScreen(L: Layout): void {
  listScreen("challenges", L, T("Challenges"), (w) => CHALLENGES.forEach((c: { build(): Def }, i: number) => {
    const def = c.build();
    setupCard(`challenge-${i}`, def, w, null, false, () => startRound(def));
  }));
}
function practiceScreen(L: Layout): void {
  listScreen("practice", L, T("Practice"), (w) => {
    PRACTICE_DIFFICULTIES.forEach((d: { id: string }, i: number) => {
      const def = practiceDef(d.id) as Def;
      setupCard(`practice-${i}`, def, w, null, false, () => startRound(practiceDef(d.id) as Def));
    });
    const bw = buttonWidth(T("Start seeded"), PLAIN);
    ui.row("seed-row", () => {
      app.seedText = ui.style("seed-field").textField("seed-field", app.seedText, { maxChars: 40, width: Math.max(120, w - bw - 8), placeholder: T("Custom seed (shareable)") });
      button({
        id: "btn-seeded", text: T("Start seeded"), act: () => {
          const diff = PRACTICE_DIFFICULTIES[0] as { id: string };
          const seed = app.seedText.trim();
          const def = practiceDef(diff.id, seed || undefined) as Def;
          def.id = `custom:${seed || def.seed}`;
          startRound(def);
        },
      });
    }, { spacing: 8, align: "center", padding: { top: 13 } });
  });
}
function scoresScreen(L: Layout): void {
  page("scores", L, 640, (w) => {
    ui.style("h1").id("scores-h").heading(T("Scores & History"));
    ui.column("score-list", () => {
      if (!history.length) para(T("No completed rounds yet."), w);
      for (const [i, r] of history.slice(-10).reverse().entries()) {
        const date = new Date(r.at).toLocaleDateString(currentLocale(), { timeZone: "UTC" });
        const text = `${date} · ${r.contentId} — ${T(r.status === "won" ? N("Won") : N("Lost"))} · ` + T("score {total} (base {base}, moves {moves}, webs +{webs}, time +{time}, no-undo +{noUndo})", {
          total: r.score.total, base: r.score.base, moves: r.score.movePenalty, webs: r.score.runs, time: r.score.time, noUndo: r.score.noUndo,
        });
        ui.column(`hist-${i}`, () => para(text, w, "score-row-text"), { style: "score-row", width: w });
      }
    }, { spacing: 0, width: w });
    // Today's daily board: this device's daily rounds (no own-server board).
    const day = platform.todayUTC();
    const today = history.filter((r) => r.contentId === `daily-${day}` && r.status === "won").sort((a, b) => b.score.total - a.score.total);
    ui.column("daily-board", () => {
      para(T("Daily board — {day} (this device)", { day }), w, "h2", "daily-h");
      if (!today.length) para(T("No daily wins yet today."), w, "dim");
      today.slice(0, 10).forEach((r, i) => ui.column(`day-${i}`, () => para(T("#{n} — score {total} · webs {webs} · {moves} moves", { n: i + 1, total: r.score.total, webs: r.foundations, moves: r.moves }), w, "score-row-text"), { style: "score-row", width: w }));
    }, { spacing: 4, width: w });
  }, backFooter(() => show("modes", "mode-0")), false);
}
function helpScreen(L: Layout): void {
  const move = ["left", "right", "up", "down"].map(keyLabel).join("/");
  const entries: [string, string][] = [
    [T("Build down"), T("A card (or a whole same-thread descending run) rests on a card exactly one rank higher.")],
    [T("Threads travel together"), T("Only same-suit descending runs move as a group. Mixed stacks move one card at a time from the top.")],
    [T("Clear webs"), T("A complete King-to-Ace run of one thread lifts off the table. Clear eight webs to win.")],
    [T("The stock"), T("Deal adds one face-up card to every column — only when no column is empty. Five deals per round.")],
    [T("Empty columns"), T("Any run may rest in an empty column. They are your work space.")],
    [T("Controls"), T("Tap or click a card to lift its run, then tap a destination. Keyboard: {move} move focus, {confirm} lifts/drops, {deal} deals, {hint} hints, {undo} undoes, {pause} pauses.", {
      move, confirm: keyLabel("confirm"), deal: keyLabel("deal"), hint: keyLabel("hint"), undo: keyLabel("undo"), pause: keyLabel("pause"),
    })],
    [T("Gamepad"), T("D-pad or left stick moves focus, A lifts or drops, B sets a run down or pauses, X deals, Y hints, LB undoes, Start pauses.")],
  ];
  page("help", L, 860, (w) => {
    ui.style("h1").id("help-h").heading(T("How to play"));
    const gap = 11.2;
    const cols = Math.max(1, Math.floor((w + gap) / (220 + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    ui.column("help-grid", () => {
      for (let i = 0; i < entries.length; i += cols) {
        ui.row(`hg-${i}`, () => {
          for (let j = i; j < Math.min(entries.length, i + cols); j++) {
            const [h, d] = entries[j]!;
            ui.column(`help-${j}`, () => { para(h, cw - 28, "strong"); para(d, cw - 28, "card-sub"); }, { style: "help-card", width: cw, spacing: 4 });
          }
        }, { spacing: gap, align: "stretch" });
      }
    }, { spacing: gap, width: w });
  }, backFooter(helpBack), false);
}

// ------------------------------------------------------------------ the round
function topBar(L: Layout): number {
  const def = session.def;
  const ck = clockText();
  const h = L.short ? 40 : 44;
  const r = ui.place("top-bar", { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.row("top-row", () => {
      if (ui.style("btn", "icon-btn").id("btn-menu").button(T("Pause menu"), { content: () => ui.label("☰") })) showPause();
      const clock = ck.timed ? `⏱ ${ck.text}` : ck.text;
      const cw = ck.text ? textWidth(clock, ck.urgent ? "top-clock-urgent" : "top-clock") : 0;
      const tw = Math.max(40, L.lw - 20 - 44 - cw - 20);
      ui.style("top-title").id("top-title").label(ellipsize(def ? defTitle(def) : "", tw, "top-title"));
      ui.spacer();
      if (ck.text) {
        ui.style(ck.urgent ? "top-clock-urgent" : "top-clock").id("top-clock").label(clock);
      }
    }, { width: L.lw - 20, height: h, align: "center", spacing: 10 });
  }, { style: "top-bar", width: L.lw });
  return r.height / L.sc;
}
function tray(L: Layout): number {
  const st = session.state;
  const assists = session.def?.assists ?? { hints: true, undo: true };
  const list: Btn[] = [
    { id: "btn-undo", text: T("Undo"), disabled: !assists.undo, act: doUndo },
    { id: "btn-hint", text: T("Hint"), disabled: !assists.hints, act: doHint },
    { id: "btn-deal", text: T("Deal"), style: ["btn-primary"], disabled: !st || st.stock.length === 0, act: doDeal, ...(st && st.stock.length === 0 ? { tip: T("The stock is empty") } : {}) },
  ];
  if (options.leftHanded) list.reverse();
  const r = ui.place("tray", { anchor: "bottom-start", x: 0, y: 0 }, () => {
    ui.row("tray-row", () => { for (const b of list) button(b); }, { width: L.lw - (L.short ? 10 : 16), height: L.short ? 38 : 44, justify: "center", align: "center", spacing: 8 });
  }, { style: L.short ? "bottom-tray-short" : "bottom-tray", width: L.lw });
  return r.height / L.sc;
}
function rails(L: Layout, top: number, bottom: number, rw: number): void {
  const st = session.state;
  if (!st) return;
  const h = L.lh - top - bottom;
  const inner = rw - 20;
  ui.place("rail-left", { anchor: "top-start", x: 0, y: top }, () => ui.column("rail-l", () => {
    ui.style("rail-title").id("rail-objective").label(T("Objective").toUpperCase());
    ui.column("rail-l-in", () => {
      para(objectiveText(), inner, "rail-text", "objective");
      para(T("{hidden} cards hidden · stock deals left: {deals}", { hidden: faceDownCount(st), deals: st.stock.length }), inner, "rail-dim", "hidden-line");
      const s = st.score;
      para(T("Score {total}  (base {base} − moves {moves} + webs {webs} + time {time} + no-undo {noUndo})", {
        total: s.total, base: s.base, moves: -s.movePenalty, webs: s.runs, time: s.time, noUndo: s.noUndo,
      }), inner, "rail-text", "score-line");
      para(T("Moves {moves} · Invalid {invalid}", { moves: `${st.moves}${st.limits.moves ? "/" + st.limits.moves : ""}`, invalid: st.invalid }), inner, "rail-dim", "moves-line");
    }, { spacing: 6.4, width: inner });
  }, { style: "rail-left", width: rw, height: h, spacing: 6.4 }), { width: rw });
  ui.place("rail-right", { anchor: "top-start", x: L.lw - rw, y: top }, () => ui.column("rail-r", () => {
    para(st.status === "active" ? T("Your move") : T(STATUS_TEXT[st.status] || st.status.toUpperCase()), inner, "rail-text", "status-line");
  }, { style: "rail-right", width: rw, height: h }), { width: rw });
}

function playScreen(L: Layout): void {
  const st = session.state;
  if (!st) { goTitle(); return; }
  const f = frame();
  const t = theme();
  const top = topBar(L);
  const bottom = tray(L);
  let x0 = 0, x1 = L.lw;
  if (L.wide) {
    const rw = 220;
    rails(L, top, bottom, rw);
    x0 = rw; x1 = L.lw - rw;
  }
  const pw = Math.max(40, x1 - x0), ph = Math.max(40, L.lh - top - bottom);
  const bx = L.ox + x0, by = L.oy + top;
  // The safe-area margins outside the bars (the 3D table fills the window behind the UI).
  const sa = f.safeArea;
  if (sa.top > 0) draw.rect(0, 0, f.width, sa.top, t.panel);
  if (sa.bottom > 0) draw.rect(0, f.height - sa.bottom, f.width, sa.bottom, t.panel);
  if (sa.left > 0) draw.rect(0, 0, sa.left, f.height, t.panel);
  if (sa.right > 0) draw.rect(f.width - sa.right, 0, sa.right, f.height, t.panel);
  const Lt = layoutTable(bx, by, pw, ph, L.phone);
  if (Lt) board(Lt, x0, top, L);
}

// ------------------------------------------------------------------ the card layer (ui.js syncBoard)
const CARD_FACE = "#fdfaf2";
function cardBox(r: ui.Rect, faceUp: boolean, detailed: boolean, hc: boolean): void {
  const t = theme();
  const bw = hc ? 2.5 : 1.5;
  if (faceUp) {
    draw.box(r.x, r.y, r.width, r.height, {
      background: detailed ? [
        { type: "radial", center: { x: 0.3, y: 0 }, radius: { x: 1.2, y: 0.8 }, stops: [{ color: "#ffffffbf", at: 0 }, { color: "#ffffff00", at: 0.6 }] },
        { type: "linear", angle: 170, stops: [{ color: "#fffaf000", at: 0.55 }, { color: "#785a3212", at: 1 }] },
        CARD_FACE,
      ] : CARD_FACE,
      radius: 8, border: { width: bw, color: "#0000002e" },
      shadow: detailed ? [{ y: 1, blur: 1, color: "#0000002e" }, { y: 3, blur: 8, color: "#00000024" }, { spread: 1, color: "#ffffffb3", inset: true }] : { y: 1, blur: 2, color: "#00000040" },
    });
  } else {
    if (detailed) { backStyles(t.felt); draw.box(r.x, r.y, r.width, r.height, ["card-back", hc ? "card-back-hc" : ""].filter(Boolean)); }
    else draw.box(r.x, r.y, r.width, r.height, { background: t.felt, radius: 8, border: { width: bw, color: "#00000059" }, shadow: { y: 1, blur: 2, color: "#00000040" } });
  }
}
// The detailed card back (index.html .gfx-detailed .card.face-down: silk spokes, rings every 8 px and a
// soft sheen) and the stock's 45° stripes, painted once per felt colour into canvas textures: the same
// patterns as repeating CSS gradients cost the overlay too many vertices across a full table.
const backs = new Map<string, Texture>();
function backTexture(felt: string): Texture {
  const hit = backs.get("b" + felt);
  if (hit) return hit;
  const W = 128, H = 180;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext("2d")!;
  g.fillStyle = felt; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,240,215,0.11)";
  for (let k = 0; k < 12; k++) {
    const a = ((8 + k * 30) * Math.PI) / 180 - Math.PI / 2;
    g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, 200, a, a + (1.2 * Math.PI) / 180); g.closePath(); g.fill();
  }
  g.strokeStyle = "rgba(255,240,215,0.08)"; g.lineWidth = 1;
  for (let r = 7.5; r < 120; r += 8) { g.beginPath(); g.arc(W / 2, H / 2, r, 0, Math.PI * 2); g.stroke(); }
  const lin = g.createLinearGradient(0, 0, W * 0.34, H);
  lin.addColorStop(0, "rgba(255,255,255,0.08)"); lin.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = lin; g.fillRect(0, 0, W, H);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  backs.set("b" + felt, tex);
  return tex;
}
let backFelt = "";
/** The card back's and the stock's classes for this felt (draw.box takes a texture through a registered style). */
function backStyles(felt: string): void {
  if (backFelt === felt) return;
  backFelt = felt;
  ui.setStyles({
    ".card-back": {
      background: [{ image: backTexture(felt), size: "cover" }, felt], radius: 8, border: { width: 1.5, color: "#00000059" },
      shadow: [{ y: 1, blur: 2, color: "#0000004d" }, { spread: 2, color: "#ffebc81a", inset: true }],
    },
    ".card-back-hc": { border: { width: 2.5, color: "#00000059" } },
    ".stock-back": { background: [{ image: stripeTexture(felt), size: [32, 32], repeat: true }, felt], radius: 8, border: { width: 2, color: "#0000004d" } },
  });
}
function stripeTexture(felt: string): Texture {
  const hit = backs.get("s" + felt);
  if (hit) return hit;
  const W = 64, H = 64;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext("2d")!;
  g.fillStyle = felt; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 4 / Math.SQRT2 * 2;
  for (let k = -W; k < W * 2; k += 8 * Math.SQRT2) { g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  backs.set("s" + felt, tex);
  return tex;
}
/** A dashed rounded outline (CSS outline: 3px dashed), as dashes along the box's edges. */
function dashedRect(x: number, y: number, w: number, h: number, color: string, lw: number, dash: number): void {
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.floor(len / (dash * 2)));
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * dash) / len, b = Math.min(1, ((i * 2 + 1) * dash) / len);
      draw.line(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, color, lw);
    }
  };
  const o = lw / 2;
  seg(x + o, y + o, x + w - o, y + o);
  seg(x + w - o, y + o, x + w - o, y + h - o);
  seg(x + w - o, y + h - o, x + o, y + h - o);
  seg(x + o, y + h - o, x + o, y + o);
}
function board(Lt: TableLayout, x0: number, y0: number, L: Layout): void {
  const st = session.state!;
  const t = theme();
  const S = suits();
  const hc = pr().highContrast;
  const rm = pr().reducedMotion;
  const detailed = frame().quality !== "low";
  const sel = session.selection;
  const hint = app.hintMove;
  const fc = app.focusCard;
  const targets = sel ? session.legalTargets() : [];
  const vw = L.lw / 100;
  const rankSize = Math.max(12, 1.4 * vw), glyphSize = Math.max(14, 2.4 * vw);
  const blocked = !!app.modal || !!app.countdown;
  const at = (id: string, r: BoxRect, build: () => void): void => { ui.place(id, { anchor: "top-start", x: r.x, y: r.y }, build); };
  // A press acts once the whole board is built from this frame's state.
  let act: (() => void) | null = null;
  ui.place("board", { anchor: "top-start", x: x0, y: y0 }, () => ui.stack("board-stack", () => {
    // Stock packets (the top one carries the Deal label).
    st.stock.forEach((_, i) => {
      const r = Lt.stock[i]!;
      const top = i === st.stock.length - 1;
      at(`stock-${i}`, r, () => {
        const res = ui.id(`stock-${i}`).widget(T("Stock packet {n}. Deal one card to every column.", { n: i + 1 }), {
          role: "button", size: { width: r.w, height: r.h }, disabled: blocked,
          draw: (q) => {
            const k = pr().scale;
            backStyles(t.felt);
            draw.box(q.x, q.y, q.width, q.height, "stock-back");
            if (top) {
              const label = T("deal").toUpperCase();
              const size = 12 * k;
              const lw = draw.measureText(label, { size, letterSpacing: 1.2 * k }).width;
              if (lw <= q.width - 6 * k) draw.text(label, q.x + q.width / 2, q.y + q.height / 2 - size * 0.6, { size, color: "#ffffff", align: "center", letterSpacing: 1.2 * k });
              else draw.text(label, q.x + q.width + 6 * k, q.y + q.height / 2 - size * 0.6, { size, color: t.paper, letterSpacing: 1.2 * k, shadow: { color: "#00000099", x: 0, y: 1 * k } });
            }
          },
        });
        if (res.activated) act = doDeal;
      });
    });
    // Foundations (cleared webs).
    for (let i = 0; i < st.foundations && i < Lt.foundations.length; i++) {
      const r = Lt.foundations[i]!;
      at(`web-${i}`, r, () => ui.widget(T("Web {n} complete", { n: i + 1 }), {
        role: "image", size: { width: r.w, height: r.h },
        draw: (q) => {
          draw.box(q.x, q.y, q.width, q.height, {
            background: detailed ? [{ type: "radial", center: { x: 0.4, y: 0.3 }, radius: "closest-side", shape: "circle", stops: ["#ffffff59", "#ffffff00"] }, t.accent] : t.accent,
            radius: 8, border: { width: 1, color: t.rule }, ...(detailed ? { shadow: { y: 2, blur: 8, color: "#0000004d" } } : {}),
          });
          const fs = Math.min(q.width, q.height) * 0.5;
          draw.text("🕸", q.x + q.width / 2, q.y + q.height / 2 - fs * 0.62, { size: fs, align: "center", color: "#ffffff" });
        },
      }));
    }
    // Column pads (empty-column drop targets).
    Lt.pads.forEach((p, c) => {
      if (st.cols[c]!.length) return;
      at(`pad-${c}`, p, () => {
        const res = ui.id(`pad-${c}`).widget(T("Column {n} (empty)", { n: c + 1 }), {
          role: "button", size: { width: p.w, height: p.h }, disabled: blocked,
          draw: (q) => {
            const k = pr().scale;
            draw.roundRect(q.x, q.y, q.width, q.height, 8 * k, "#0000001f");
            dashedRect(q.x, q.y, q.width, q.height, t.rule, 2 * k, 6 * k);
            if (fc && fc.col === c) draw.strokeRoundRect(q.x - 4 * k, q.y - 4 * k, q.width + 8 * k, q.height + 8 * k, 11 * k, t.select, 3 * k);
          },
        });
        if (res.activated) act = () => tapPad(c);
      });
    });
    // Cards.
    st.cols.forEach((col, c) => col.forEach((cd, i) => {
      const r = Lt.cols[c]![i]!;
      const lifted = !!sel && sel.from === c && i >= sel.idx;
      const hinted = !!hint && hint.from === c && i >= hint.idx;
      const focused = !!fc && fc.col === c && fc.idx === i;
      at(`card-${c}-${i}`, r, () => {
        const res = ui.id(`card-${c}-${i}`).widget(cardLabel(c, i, st), {
          role: "button", size: { width: r.w, height: r.h }, disabled: !cd.u || blocked,
          draw: (q0) => {
            const k = pr().scale;
            const dy = lifted && !rm ? -4 * k : 0;
            const q = { x: q0.x, y: q0.y + dy, width: q0.width, height: q0.height };
            if (lifted) draw.box(q.x, q.y, q.width, q.height, { radius: 8, shadow: { y: 6, blur: 14, color: "#00000059" } });
            cardBox(q, !!cd.u, detailed, hc);
            if (cd.u) {
              const suit = S[cd.s]!;
              draw.text(rankLabel(cd.r), q.x + q.width * 0.07, q.y + 2 * k, { size: rankSize * k, weight: "700", color: suit.color });
              draw.text(suit.glyph, q.x + q.width / 2, q.y + q.height / 2 - glyphSize * 0.62 * k, { size: glyphSize * k, color: suit.color, align: "center" });
            }
            if (lifted) draw.strokeRoundRect(q.x - 3 * k, q.y - 3 * k, q.width + 6 * k, q.height + 6 * k, 10 * k, t.select, 3 * k);
            else if (hinted) dashedRect(q.x - 3 * k, q.y - 3 * k, q.width + 6 * k, q.height + 6 * k, t.accent, 3 * k, 7 * k);
            if (focused && !lifted) draw.strokeRoundRect(q.x - 4 * k, q.y - 4 * k, q.width + 8 * k, q.height + 8 * k, 11 * k, t.select, 3 * k);
          },
        });
        if (res.activated && !dragged && !(options.holdToDrag && pointerPress)) act = () => tapCard(c, i);
      });
    }));
    // Legal target highlight while a run is lifted (over the cards, never taking the pointer).
    for (const to of targets) {
      const p = Lt.pads[to]!;
      at(`target-${to}`, p, () => ui.widget("", {
        role: "none", size: { width: p.w, height: p.h },
        draw: (q) => {
          const k = pr().scale;
          draw.roundRect(q.x, q.y, q.width, q.height, 8 * k, t.legal + "2e");
          draw.strokeRoundRect(q.x, q.y, q.width, q.height, 8 * k, t.legal, 3 * k);
        },
      }));
    }
  }, { width: Lt.W, height: Lt.H }));
  (act as (() => void) | null)?.();
}

function countdownOverlay(L: Layout): void {
  const f = frame();
  draw.rect(0, 0, f.width, f.height, "#0a0a1059");
  const size = Math.max(64, Math.min(L.lw * 0.2, 144));
  ui.place("countdown", { anchor: "center", x: 0, y: 0 }, () => ui.style("countdown", { text: { size } }).id("countdown").label(String(app.countdown!.n)));
}

// ------------------------------------------------------------------ dialogs
/** A modal card: a scrolling body when taller than the window, a pinned footer (its buttons stay clickable). */
function dialogFrame(id: string, title: string, L: Layout, build: ((w: number) => void) | null, footer: (w: number) => void, onClose: (() => void) | null, titlePrefix = "", focus: string | null = null): void {
  const w = Math.min(560, L.lw * 0.94) - 44 - 32;
  const fh = (lastHeight.get(`dlg-${id}-foot`) ?? 56) + 12;
  const avail = Math.max(80, L.lh * 0.88 - 38 - fh - 40);
  const h = lastHeight.get(`dlg-${id}`) ?? 0;
  const body = (): void => {
    const r = ui.column(`${id}-body`, () => {
      ui.row(`${id}-title`, () => {
        const head = titlePrefix + title;
        if (textWidth(head, "h2", "heading") <= w) ui.style("h2").id(`${id}-h`).heading(head);
        else ui.style("h2").paragraph(head, w);
      }, { spacing: 8, align: "center" });
      build?.(w);
    }, { spacing: 8.8, width: w });
    lastHeight.set(`dlg-${id}`, r.height / L.sc);
  };
  const fresh = frame().frame - app.modalOpened <= 4;
  const open = ui.dialog(title, "", true, () => {
    if (h > avail) ui.scrollArea(`${id}-scroll`, { width: w + 14, height: avail }, body, fresh ? { scrollTo: { top: 0 } } : undefined);
    else body();
    const r = ui.column(`${id}-foot`, () => footer(w), { width: w, spacing: 8.8, padding: { top: 12 } });
    lastHeight.set(`dlg-${id}-foot`, r.height / L.sc - 12);
  });
  // ui.js modal(): the first control takes the focus as it opens.
  const age = frame().frame - app.modalOpened;
  if (focus && age >= 1 && age <= 3) ui.setFocus(focus);
  // The Escape (or East) that opened it must not close it the same frame.
  if (!open && frame().frame !== app.modalOpened && onClose) onClose();
}
function dialogs(L: Layout): void {
  switch (app.modal) {
    case "pause":
      dialogFrame("pause", T("Paused"), L, (w) => {
        if (app.restored) para(T("Round restored from your last safe snapshot."), w, "dim", "restored-note");
        settingsSection(w);
      }, (w) => {
        button({ id: "btn-resume-round", text: T("Resume"), style: ["btn-primary", "btn-big"], act: resumeRound }, w);
        flow("pause-actions", [
          { id: "btn-pause-help", text: T("Help"), act: openHelp },
          { id: "btn-restart", text: T("Restart round"), act: restartRound },
          { id: "btn-giveup", text: T("Give up"), style: ["btn-danger"], act: giveUp },
          { id: "btn-leave", text: T("Leave to title"), act: leaveRound },
        ], w);
      }, resumeRound, "", "btn-resume-round");
      return;
    case "settings":
      dialogFrame("settings", T("Settings"), L, settingsSection, (w) => button({ id: "btn-close", text: T("Close"), style: ["btn-primary"], act: closeModal }, w), closeModal, "", "btn-options");
      return;
    case "results": resultsDialog(L); return;
    default:
  }
}
/** ui.js settingsSection: the table's options; the rest are the runtime's Options. */
function settingsSection(w: number): void {
  const inner = w - 24;
  ui.column("settings", () => {
    ui.style("legend").label(T("Settings"));
    para(T("Volumes, mute, graphics quality, frame rate, language, reduced motion, high contrast and text size are in the StarHermit Options."), inner, "dim");
    flow("set-runtime", [{ id: "btn-options", text: T("Open Options"), act: () => openMenu() }], inner, "start");
    const select = (id: string, label: string, cur: number, items: string[], set: (i: number) => void): void => {
      ui.row(`${id}-row`, () => {
        para(T(label), Math.max(80, inner * 0.45), "body");
        ui.spacer();
        const next = ui.style({ width: Math.min(220, inner * 0.52) }).id(id).select(T(label), cur, items);
        if (next !== cur) set(next);
      }, { width: inner, align: "center", spacing: 10 });
    };
    const ti = Math.max(0, THEMES.findIndex((x: { id: string }) => x.id === options.theme));
    select("set-theme", N("Theme"), ti, THEMES.map((x: { name: string }) => T(x.name)), (i) => platform.setOption("theme", (THEMES[i] as { id: string }).id));
    const CVD: [string, string][] = [["none", N("Default")], ["deuter", N("Deuteranopia-safe")], ["protan", N("Protanopia-safe")], ["tritan", N("Tritanopia-safe")]];
    const ci = Math.max(0, CVD.findIndex(([v]) => v === options.cvd));
    select("set-cvd", N("Color-vision palette"), ci, CVD.map(([, n]) => T(n)), (i) => platform.setOption("cvd", CVD[i]![0]));
    const toggle = (key: "leftHanded" | "holdToDrag" | "haptics", label: string): void => {
      const cur = options[key];
      const next = ui.id(`set-${key}`).checkbox(T(label), cur);
      if (next !== cur) platform.setOption(key, next);
    };
    toggle("leftHanded", N("Left-handed controls"));
    toggle("holdToDrag", N("Hold to drag (vs tap)"));
    toggle("haptics", N("Haptics"));
    flow("set-keys", [{ id: "btn-rebind", text: T("Change keys and buttons"), act: () => requestRebind() }], inner, "start");
  }, { style: "settings", width: w, spacing: 6.4 });
}
function resultsDialog(L: Layout): void {
  const x = app.results;
  if (!x) { closeModal(); return; }
  const { st, won, newly } = x;
  dialogFrame("results", headline(x), L, (w) => {
    if (!L.short) art("results-art", won ? "assets/results-win.webp" : "assets/results-over.webp", w, Math.min(w * 9 / 16, 150), 10, false);
    const s = st.score;
    const rows: [string, string][] = [
      [N("Base"), String(s.base)], [N("Moves"), String(s.movePenalty)], [N("Webs"), `+${s.runs}`],
      [N("Time bonus"), `+${s.time}`], [N("No-undo bonus"), `+${s.noUndo}`], [N("Total"), String(s.total)],
    ];
    ui.column("score-breakdown", () => {
      for (const [k, v] of rows) ui.row(`sb-${k}`, () => { para(T(k), w - 90, "dt"); ui.spacer(); ui.style("dd").id(`sb-${k}-v`).label(v); }, { width: w, align: "center" });
    }, { spacing: 2.4, width: w });
    const time = `${Math.floor(st.elapsedMs / 60000)}:${String(Math.floor(st.elapsedMs / 1000) % 60).padStart(2, "0")}`;
    para(T("{moves} moves · {invalid} invalid · {time}", { moves: st.moves, invalid: st.invalid, time }) + (st.terminalReason ? " · " + T(TERMINAL_TEXT[st.terminalReason] || st.terminalReason) : ""), w, "dim", "results-line");
    const lb = leaderboardLine();
    if (lb) para(lb, w, "dim", "results-lb");
    for (const k of newly) {
      const a = ACHIEVEMENTS.find((q: { key: string }) => q.key === k) as { name: string; desc: string } | undefined;
      ui.row(`ach-${k}`, () => { para(`🏅 ${a ? T(a.name) : k} — ${a ? T(a.desc) : ""}`, w - 24, "body"); }, { style: "achievement", width: w, spacing: 8, align: "center" });
    }
  }, (w) => {
    const next = nextRecommended();
    const list: Btn[] = [
      { id: "btn-retry", text: T("Retry"), style: ["btn-primary"], act: resultsRetry },
      { id: "btn-next", text: T(next.label), act: next.act },
      { id: "btn-title", text: T("Title"), act: resultsTitle },
    ];
    // Short windows: the three in a row, so the score keeps the room.
    if (L.short) flow("results-actions", list, w);
    else for (const b of list) button(b, w);
  }, null, won ? "🕸 " : "", "btn-retry");
}

// ------------------------------------------------------------------ toasts and captions
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(520, L.lw * 0.9);
  ui.place("toast-root", { anchor: "bottom", y: L.lh * 0.12 }, () => ui.column("toast-col", () => {
    app.toasts.forEach((t, i) => {
      if (textWidth(t.text, "toast") + 32 <= w) ui.style("toast").id(`toast-${i}`).label(t.text);
      else ui.style("toast").id(`toast-${i}`).paragraph(t.text, w - 32);
    });
  }, { spacing: 6, align: "center" }));
}
function caption(L: Layout): void {
  const c = app.caption;
  if (!c) return;
  ui.place("caption", { anchor: "bottom", y: 64 }, () => ui.row("caption-row", () => {
    ui.style("caption").id("caption").label(`♪ ${c.text}`);
  }, { spacing: 3, align: "center" }));
  void L;
}
