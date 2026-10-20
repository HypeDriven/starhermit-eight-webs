// Eight Webs — ui: responsive DOM shell over/beside the Three.js canvas.
// The DOM layer is a complete, fully playable semantic interface: canvas is
// never the only UI. UI state is separate from simulation state — closing a
// drawer or opening a modal cannot affect the round.

import {
  listLegalMoves, rankLabel, canDeal, faceDownCount, cardsInPlay, topRunLength,
} from './rules.js';
import {
  SUITS, THEMES, getTheme, LESSONS, JOURNEY, CHALLENGES, PRACTICE_DIFFICULTIES,
  practiceDef, dailyForDate, ACHIEVEMENTS,
} from './content.js';
import { computeLayout } from './render.js';
import { mergeProgress } from './session.js';
import { CATEGORIES, PRESETS, presetTier, choosePreset, resolve as resolveGfx, describe as describeGfx } from './gfx.js';
import { gfxStrings, fmt } from './gfx-i18n.js';
import { T, N, getLang, onLanguage } from './i18n.js';

const SETTINGS_KEY = 'eightwebs:settings';
const PROGRESS_KEY = 'eightwebs:progress';
const HISTORY_KEY = 'eightwebs:history';

export const DEFAULT_SETTINGS = {
  theme: 'shadowbox',
  graphics: {}, // gfx.js saved shape: { preset: 'auto'|low|…, render_scale, adaptive, show_fps, <category> }
  muted: false, volMusic: 0.6, volEffects: 0.8, volAmbience: 0.4, volVoice: 0.8,
  reducedMotion: false, highContrast: false, largeText: false,
  leftHanded: false, holdToDrag: false, haptics: true, cvd: 'none', // none|deuter|protan|tritan
  cameraPreset: 'table',
};

// Keyboard actions as KeyboardEvent.code values; platform overrides apply via
// StarHermit controls (control.* lines in starhermit.txt).
export const DEFAULT_KEYS = {
  left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
  confirm: ['Enter', 'Space'], deal: ['KeyD'], hint: ['KeyH'], undo: ['KeyU'], pause: ['Escape'],
};

const CVD_SUIT_COLORS = {
  // Color-vision-safe palettes; shape/label cues always accompany color.
  deuter: ['#0072b2', '#e69f00', '#009e73', '#cc79a7'],
  protan: ['#0072b2', '#f0e442', '#009e73', '#d55e00'],
  tritan: ['#0173b2', '#de8f05', '#029e73', '#cc78bc'],
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Element whose text is a translation key: relabelled in place on a language change.
function tx(tag, cls, key) {
  const e = el(tag, cls, T(key));
  e.dataset.i18n = key;
  return e;
}

// Display title of a round definition (content keeps the US-English titles;
// snapshots carry them too, so translate at display time).
export function defTitle(def) {
  const t = String(def?.title || '');
  let m = /^(\d+)\. (.+)$/.exec(t);
  if (m) return `${m[1]}. ${T(m[2])}`;
  m = /^Daily — (.+)$/.exec(t);
  if (m) return T('Daily — {date}', { date: m[1] });
  m = /^Practice — (.+)$/.exec(t);
  if (m) return T('Practice — {name}', { name: T(m[1]) });
  return T(t);
}

const STATUS_TEXT = { won: N('WON'), lost: N('LOST'), aborted: N('ABANDONED') };
const TERMINAL_TEXT = {
  'all-runs': N('all webs cleared'), 'move-limit': N('move limit reached'), 'time-limit': N('time ran out'),
  'no-moves': N('no moves left'), 'gave-up': N('gave up'),
};

export class UI {
  constructor(root, session, platform, renderer, audio) {
    this.root = root;
    this.session = session;
    this.platform = platform;
    this.renderer = renderer;
    this.audio = audio;
    this.settings = { ...DEFAULT_SETTINGS, ...(platform.loadLocal(SETTINGS_KEY) || {}) };
    delete this.settings.tier; // replaced by the Graphics presets
    if (!this.settings.graphics || typeof this.settings.graphics !== 'object') this.settings.graphics = {};
    this.progress = platform.loadLocal(PROGRESS_KEY) || {
      v: 1, journey: {}, lessonsDone: {}, achievements: {}, websCleared: 0,
      daysPlayed: [], bests: {}, mastery: {},
    };
    this.history = platform.loadLocal(HISTORY_KEY) || [];
    this.screen = 'title';
    this.liveModals = new Set(); // dialogs re-rendered on a language change
    this.focusCard = null; // {col, idx} keyboard cursor
    this.drag = null;
    this.hintMove = null;
    this.suits = this.themedSuits();
    this.build();
    this.applySettings();
    this.setBindings(DEFAULT_KEYS);
    // Signed in: the remote progress document, platform settings and key
    // bindings win over the local ones.
    this.platform.onSync?.(() => this.refreshPlatformLine());
    this.platform.onAuth?.(() => { if (this.screen === 'title') this.show('title'); this.syncFromPlatform(); });
    this.platform.onSaveConflict?.(() => this.mergeCloudConflict());
    onLanguage(() => this.onLanguageChange());
    this.syncFromPlatform();
  }

  // Another device wrote the cloud slot since our last load (the SDK's
  // conditional write got 412 and blocks further writes): reload the slot,
  // merge it with this device's progress and save the merge back.
  mergeCloudConflict() {
    if (this._merging || !this.platform.tokenHosted) return;
    this._merging = true;
    this.platform.loadCloudSave().then((remoteJson) => {
      if (this.platform.saveConflicted() || this.platform.cloudLoadFailed()) return; // reload failed: writes stay blocked
      let remote = null;
      try { remote = remoteJson ? JSON.parse(remoteJson) : null; } catch { remote = null; }
      this.progress = mergeProgress(remote && remote.v === 1 ? remote : null, this.progress);
      this.saveProgress(); // pushes the merge to the cloud slot
      if (this.screen !== 'play') this.onLanguageChange(); // redraw counts in place
    }).catch(() => {}).then(() => { this._merging = false; });
  }

  // The game language changed: redraw whatever is showing, in place. The
  // round, its clock, the save and the platform connection are untouched;
  // open dialogs stay open (Settings relabels in place so the shared option
  // sections mounted inside it survive).
  onLanguageChange() {
    const active = document.activeElement;
    if (this.screen !== 'play') {
      const modals = [...this.overlay.querySelectorAll(':scope > .modal-wrap')];
      this.show(this.screen);
      for (const m of modals) this.overlay.append(m);
    } else {
      this.buildTopBar();
      this.rebuildTray();
      this.syncBoard();
      const help = this.overlay.querySelector(':scope > .menu-screen.help');
      if (help) { help.remove(); this.screenHelp(); }
    }
    for (const m of this.liveModals) m.render();
    for (const g of this.overlay.querySelectorAll('.gfx-settings')) g._relabel?.();
    if (active && active.isConnected && active !== document.activeElement) active.focus({ preventScroll: true });
  }

  syncFromPlatform() {
    const P = this.platform;
    if (!P.tokenHosted) return;
    P.fetchProfile().then(() => this.refreshPlatformLine()).catch(() => {});
    this._platformSettingsReady = false;
    P.loadCloudSave().then((remoteJson) => {
      if (!remoteJson) return;
      try {
        const remote = JSON.parse(remoteJson);
        if (remote && remote.v === 1) {
          this.progress = remote;
          this.saveProgress(); // local cache mirrors the remote doc
          this.applySettings();
        }
      } catch { /* corrupt remote: keep local */ }
    }).catch(() => {}).then(() => P.getSettings()).then((remote) => {
      this._platformSettingsReady = true;
      let changed = false;
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        const v = remote?.[k];
        if (v == null || typeof v !== typeof DEFAULT_SETTINGS[k]) continue;
        this.settings[k] = v; changed = true;
      }
      if (changed) this.applySettings();
      this.refreshPlatformLine();
    }, () => { this._platformSettingsReady = true; });
    P.loadBindings(DEFAULT_KEYS).then((b) => this.setBindings(b)).catch(() => {});
  }

  setBindings(b) {
    this.bindings = b;
    this.keyAction = {};
    for (const [a, codes] of Object.entries(b)) for (const c of codes || []) this.keyAction[c] = a;
  }
  keyLabel(action) {
    return (this.bindings[action] || []).map((c) => String(c).replace(/^Key|^Digit/, '').replace(/^Arrow(.+)$/, '$1').replace(/^Escape$/, 'Esc')).join('/');
  }

  // Title: "Playing as …" + sign-in / Invite a friend buttons.
  refreshPlatformLine() {
    const line = this.root.querySelector('.title-platform');
    if (!line) return;
    line.replaceChildren();
    const P = this.platform;
    const status = this.renderStatus();
    if (status) line.append(el('p', 'title-progress', status));
    if (P.canSignIn()) line.append(this.button(N('Sign in with StarHermit'), () => P.signIn(), 'btn btn-signin'));
    if (P.tokenHosted && P.inviteLink()) line.append(this.button(N('Invite a friend'), () => this.inviteFriend(), 'btn btn-invite'));
  }

  inviteFriend() {
    const link = this.platform.inviteLink();
    if (!link) return;
    const fail = () => this.toast(T('Could not copy — invite link: {link}', { link }));
    try { navigator.clipboard.writeText(link).then(() => this.toast(T('Invite link copied to the clipboard.')), fail); } catch { fail(); }
  }

  // Account + cloud-sync status shown on the title.
  renderStatus() {
    const P = this.platform;
    if (!P?.tokenHosted) return null;
    const name = P.profile ? P.profile.name : '…';
    return T('Playing as {name}', { name }) + ' · ' +
      T(P.sync === 'synced' ? N('progress synced') : P.sync === 'saving' ? N('saving…') : N('cloud sync unavailable'));
  }

  themedSuits() {
    const cvd = CVD_SUIT_COLORS[this.settings.cvd];
    return SUITS.map((s, i) => ({ ...s, color: cvd ? cvd[i] : s.color }));
  }

  saveSettings() {
    this.platform.saveLocal(SETTINGS_KEY, this.settings);
    // Settings KV mirror, once the boot read of the platform values is applied.
    if (this.platform.tokenHosted && this._platformSettingsReady) this.platform.patchSettings({ ...this.settings });
  }
  saveProgress() { this.platform.saveLocal(PROGRESS_KEY, this.progress); }

  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------

  build() {
    this.root.innerHTML = '';
    this.shell = el('div', 'shell');
    this.shell.dataset.screen = 'title';

    this.playfield = el('div', 'playfield');
    this.playfield.id = 'playfield';
    this.boardEl = el('div', 'board');
    this.boardEl.setAttribute('role', 'application');
    this.boardEl.setAttribute('aria-label', T(N('Eight Webs card table. Use arrow keys to move between cards, Enter to pick up or drop a run, D to deal, H for a hint, U to undo, Escape for pause.')));
    this.boardEl.dataset.i18nAria = 'Eight Webs card table. Use arrow keys to move between cards, Enter to pick up or drop a run, D to deal, H for a hint, U to undo, Escape for pause.';
    this.boardEl.tabIndex = 0;
    this.playfield.append(this.boardEl);

    this.railLeft = el('aside', 'rail rail-left');
    this.railLeft.append(tx('h2', 'rail-title', 'Objective'));
    this.objectiveEl = el('div', 'objective');
    this.progressEl = el('div', 'progress-rail');
    this.railLeft.append(this.objectiveEl, this.progressEl);

    this.railRight = el('aside', 'rail rail-right');
    this.statusEl = el('div', 'status-rail');
    this.actionsEl = el('div', 'actions-rail');
    this.railRight.append(this.statusEl, this.actionsEl);

    this.topBar = el('header', 'top-bar');
    this.bottomTray = el('nav', 'bottom-tray');
    this.bottomTray.setAttribute('aria-label', T('Round actions'));
    this.bottomTray.dataset.i18nAria = 'Round actions';

    this.overlay = el('div', 'overlay-host');
    this.live = el('div', 'sr-only');
    this.live.setAttribute('aria-live', 'polite');
    this.captionEl = el('div', 'caption', '');
    this.captionEl.setAttribute('aria-hidden', 'true');

    this.shell.append(this.topBar, this.railLeft, this.playfield, this.railRight, this.bottomTray, this.overlay, this.live, this.captionEl);
    this.root.append(this.shell);
    this.bindInput();
  }

  announce(msg) {
    this.live.textContent = '';
    requestAnimationFrame(() => { this.live.textContent = msg; });
  }

  caption(text) {
    this.captionEl.textContent = `♪ ${T(text)}`;
    clearTimeout(this._capT);
    this._capT = setTimeout(() => { this.captionEl.textContent = ''; }, 1600);
  }

  haptic(ms = 12) {
    if (this.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
  }

  // -------------------------------------------------------------------------
  // Settings application
  // -------------------------------------------------------------------------

  applySettings() {
    const s = this.settings;
    const theme = getTheme(s.theme);
    this.shell.style.setProperty('--paper', theme.paper);
    this.shell.style.setProperty('--ink', theme.ink);
    this.shell.style.setProperty('--rule', theme.rule);
    this.shell.style.setProperty('--panel', theme.panel);
    this.shell.style.setProperty('--felt', theme.felt);
    this.shell.style.setProperty('--accent', theme.accent);
    this.shell.style.setProperty('--select', theme.select);
    this.shell.style.setProperty('--legal', theme.legal);
    this.shell.style.setProperty('--danger', theme.danger);
    this.shell.classList.toggle('high-contrast', s.highContrast);
    this.shell.classList.toggle('large-text', s.largeText);
    this.shell.classList.toggle('left-handed', s.leftHanded);
    this.shell.classList.toggle('reduced-motion', s.reducedMotion);
    this.suits = this.themedSuits();
    this.renderer?.setGraphics?.(s.graphics);
    const gq = this.renderer?.q || resolveGfx(s.graphics, 'balanced');
    this.shell.classList.toggle('gfx-detailed', gq.detail === 'detailed');
    this.renderer?.setSuits(this.suits);
    if (this.renderer?.ok) { this.renderer.layoutEnv?.(); this.renderer.resize?.(); }
    this.audio.applyVolumes();
    this.saveSettings();
  }

  // -------------------------------------------------------------------------
  // Screens
  // -------------------------------------------------------------------------

  show(screen) {
    this.screen = screen;
    this.shell.dataset.screen = screen;
    this.overlay.innerHTML = '';
    this.topBar.innerHTML = '';
    this.bottomTray.innerHTML = '';
    if (screen !== 'play') this.renderer?.setSelection(null, [], null);
    ({
      title: () => this.screenTitle(),
      modes: () => this.screenModes(),
      journey: () => this.screenJourney(),
      lessons: () => this.screenLessons(),
      challenges: () => this.screenChallenges(),
      practice: () => this.screenPractice(),
      help: () => this.screenHelp(),
      scores: () => this.screenScores(),
      play: () => this.screenPlay(),
    })[screen]?.();
  }

  // titleText: a translation key (relabelled in place) or a function giving the
  // display title. live: true re-runs title and buildBody after a language
  // change; otherwise the body relabels through data-i18n markup.
  modal(titleText, buildBody, { onClose, keep = false, live = false } = {}) {
    if (!keep) this.overlay.innerHTML = ''; // keep: stack over the current screen
    const wrap = el('div', 'modal-wrap');
    const modal = el('section', 'modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const h = typeof titleText === 'function' ? el('h2', null, titleText()) : tx('h2', null, titleText);
    modal.append(h);
    const body = el('div', 'modal-body');
    buildBody(body, () => close());
    modal.append(body);
    wrap.append(modal);
    this.overlay.append(wrap);
    const entry = live ? {
      render: () => {
        if (!wrap.isConnected) { this.liveModals.delete(entry); return; }
        if (typeof titleText === 'function') h.textContent = titleText();
        body.replaceChildren();
        buildBody(body, () => close());
      },
    } : null;
    if (entry) this.liveModals.add(entry);
    const prevFocus = document.activeElement;
    const close = () => {
      if (entry) this.liveModals.delete(entry);
      if (keep) wrap.remove(); else this.overlay.innerHTML = '';
      prevFocus?.focus?.();           // focus restoration after every modal
      onClose?.();
    };
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    const first = modal.querySelector('button, [tabindex], input, select');
    if (first) first.focus();
    else { modal.tabIndex = -1; modal.focus(); } // don't knock controls out of the tab order
    return close;
  }

  // label is a translation key (relabelled in place on a language change).
  button(label, onClick, cls = 'btn') {
    const b = label ? tx('button', cls, label) : el('button', cls, '');
    b.addEventListener('click', (e) => { e.stopPropagation(); this.audio.ensure(); this.audio.event('select'); onClick(); });
    return b;
  }

  // --- Title ----------------------------------------------------------------
  screenTitle() {
    this.overlay.innerHTML = '';
    const wrap = el('div', 'title-screen');
    const h1 = el('h1', null, 'Eight Webs');
    const art = el('img', 'title-art');
    art.src = 'assets/key-art.webp'; art.alt = ''; art.decoding = 'async';
    art.addEventListener('error', () => art.remove()); // decorative: vanish if missing
    const tag = tx('p', 'tagline', 'Weave descending runs of silk thread. Clear all eight webs.');
    const play = this.button('▶ Play', () => this.show('modes'), 'btn btn-primary btn-big');
    const row = el('div', 'title-row');
    row.append(
      this.button('Daily Challenge', () => this.startDaily()),
      this.button('Journey', () => this.show('journey')),
      this.button('Learn', () => this.show('lessons')),
      this.button('Scores', () => this.show('scores')),
      this.button('Help', () => this.show('help')),
      this.button('Settings', () => this.showSettings()),
    );
    const resume = this.session.hasSnapshot()
      ? this.button('Resume saved round', () => this.resumeSaved(), 'btn btn-accent')
      : null;
    const progress = el('p', 'title-progress',
      T('Journey {done}/{total} · Webs cleared {webs}', { done: Object.keys(this.progress.journey).length, total: JOURNEY.length, webs: this.progress.websCleared }));
    wrap.append(h1, art, tag, play, row);
    if (resume) wrap.append(resume);
    wrap.append(progress, el('div', 'title-platform'));
    this.overlay.append(wrap);
    this.refreshPlatformLine();
    play.focus();
  }

  resumeSaved() {
    const snap = this.session.restoreSnapshot();
    if (snap) { this.show('play'); this.syncBoard(); this.showPause(true); }
  }

  // --- Mode select -----------------------------------------------------------
  screenModes() {
    const wrap = el('div', 'menu-screen');
    wrap.append(tx('h1', null, 'Choose a mode'));
    const grid = el('div', 'menu-grid');
    const modes = [
      [N('Learn'), N('Five short lessons. One rule at a time.'), () => this.show('lessons')],
      [N('Journey'), N('Forty authored stages across five webs.'), () => this.show('journey')],
      [N('Daily'), N('One shared seed per UTC day. Ranked.'), () => this.startDaily()],
      [N('Practice'), N('Pick a difficulty. Unrated, free undo.'), () => this.show('practice')],
      [N('Challenge'), N('Move budgets, clocks, restricted tools.'), () => this.show('challenges')],
      [N('Scores'), N('Your history and the boards.'), () => this.show('scores')],
    ];
    for (const [name, desc, fn] of modes) {
      const card = this.button('', fn, 'mode-card');
      card.append(tx('strong', null, name), tx('span', null, desc));
      grid.append(card);
    }
    wrap.append(grid, this.button('← Back', () => this.show('title')));
    this.overlay.append(wrap);
    grid.querySelector('button')?.focus();
  }

  // Mode setup: rules, expected duration, assists, ranked — before commitment.
  setupCard(def, onStart) {
    const card = el('div', 'setup-card');
    const durMin = def.limits.timeMs ? Math.round(def.limits.timeMs / 60000) : null;
    const parts = [
      T(def.suits > 1 ? N('{n} threads') : N('{n} thread'), { n: def.suits }),
      durMin ? T('~{n} min clock', { n: durMin }) : T('untimed'),
    ];
    if (def.limits.moves) parts.push(T('≤{n} moves', { n: def.limits.moves }));
    card.append(
      el('strong', null, defTitle(def)),
      el('span', null, parts.join(' · ')),
      el('span', null, T('Assists: {hints}, {undo} · {ranked}', {
        hints: T(def.assists.hints ? N('hints') : N('no hints')),
        undo: T(def.assists.undo ? N('undo') : N('no undo')),
        ranked: T(def.ranked ? N('Ranked') : N('Unrated')),
      })),
      el('span', 'note', def.goals?.note ? T(def.goals.note) : ''),
      this.button('Start', onStart, 'btn btn-primary'),
    );
    return card;
  }

  screenLessons() {
    const wrap = el('div', 'menu-screen');
    wrap.append(tx('h1', null, 'Learn'));
    const list = el('div', 'menu-list');
    LESSONS.forEach((def, i) => {
      const done = this.progress.lessonsDone[def.id];
      const card = this.setupCard(def, () => this.startRound(def));
      card.prepend(el('span', 'badge', done ? '✓' : `${i + 1}`));
      list.append(card);
    });
    wrap.append(list, this.button('← Back', () => this.show('modes')));
    this.overlay.append(wrap);
  }

  screenJourney() {
    const wrap = el('div', 'menu-screen');
    wrap.append(tx('h1', null, 'Journey'));
    const list = el('div', 'menu-list');
    JOURNEY.forEach((def, i) => {
      const done = this.progress.journey[def.id];
      const prevDone = i === 0 || this.progress.journey[JOURNEY[i - 1].id];
      const card = this.setupCard(def, () => this.startRound(def));
      card.prepend(el('span', 'badge', done ? '✓' : def.goals.mastery ? '★' : `${i + 1}`));
      if (!prevDone) { card.classList.add('locked'); card.querySelector('.btn-primary').disabled = true; }
      list.append(card);
    });
    wrap.append(list, this.button('← Back', () => this.show('modes')));
    this.overlay.append(wrap);
  }

  screenChallenges() {
    const wrap = el('div', 'menu-screen');
    wrap.append(tx('h1', null, 'Challenges'));
    const list = el('div', 'menu-list');
    CHALLENGES.forEach((c) => {
      const def = c.build();
      list.append(this.setupCard(def, () => this.startRound(def)));
    });
    wrap.append(list, this.button('← Back', () => this.show('modes')));
    this.overlay.append(wrap);
  }

  screenPractice() {
    const wrap = el('div', 'menu-screen');
    wrap.append(tx('h1', null, 'Practice'));
    const list = el('div', 'menu-list');
    PRACTICE_DIFFICULTIES.forEach((d) => {
      const def = practiceDef(d.id);
      list.append(this.setupCard(def, () => this.startRound(def)));
    });
    const seedRow = el('div', 'seed-row');
    const input = el('input');
    input.type = 'text'; input.placeholder = T('Custom seed (shareable)'); input.setAttribute('aria-label', T('Custom seed'));
    seedRow.append(input, this.button('Start seeded', () => {
      const diff = PRACTICE_DIFFICULTIES[0];
      const def = practiceDef(diff.id, input.value.trim() || undefined);
      def.id = `custom:${input.value.trim() || def.seed}`;
      this.startRound(def);
    }));
    wrap.append(list, seedRow, this.button('← Back', () => this.show('modes')));
    this.overlay.append(wrap);
  }

  screenScores() {
    const wrap = el('div', 'menu-screen');
    wrap.append(tx('h1', null, 'Scores & History'));
    const list = el('div', 'menu-list');
    if (!this.history.length) list.append(tx('p', null, 'No completed rounds yet.'));
    for (const r of this.history.slice(-10).reverse()) {
      list.append(el('div', 'score-row',
        `${new Date(r.at).toLocaleDateString(getLang())} · ${r.contentId} — ${T(r.status === 'won' ? N('Won') : N('Lost'))} · ` +
        T('score {total} (base {base}, moves {moves}, webs +{webs}, time +{time}, no-undo +{noUndo})', {
          total: r.score.total, base: r.score.base, moves: r.score.movePenalty, webs: r.score.runs, time: r.score.time, noUndo: r.score.noUndo,
        })));
    }
    const lb = el('div', 'menu-list');
    wrap.append(list, lb, this.button('← Back', () => this.show('modes')));
    this.overlay.append(wrap);
    // Today's daily board: this device's daily rounds (no own-server board).
    const day = new Date(this.platform.serverNow()).toISOString().slice(0, 10);
    const today = this.history.filter((r) => r.contentId === `daily-${day}` && r.status === 'won')
      .sort((a, b) => b.score.total - a.score.total);
    lb.append(el('h2', null, T('Daily board — {day} (this device)', { day })));
    if (!today.length) lb.append(tx('p', 'dim', 'No daily wins yet today.'));
    today.slice(0, 10).forEach((r, i) => {
      lb.append(el('div', 'score-row', T('#{n} — score {total} · webs {webs} · {moves} moves', { n: i + 1, total: r.score.total, webs: r.foundations, moves: r.moves })));
    });
  }

  screenHelp() {
    const wrap = el('div', 'menu-screen help');
    wrap.append(tx('h1', null, 'How to play'));
    const cards = el('div', 'help-grid');
    const entries = [
      [T('Build down'), T('A card (or a whole same-thread descending run) rests on a card exactly one rank higher.')],
      [T('Threads travel together'), T('Only same-suit descending runs move as a group. Mixed stacks move one card at a time from the top.')],
      [T('Clear webs'), T('A complete King-to-Ace run of one thread lifts off the table. Clear eight webs to win.')],
      [T('The stock'), T('Deal adds one face-up card to every column — only when no column is empty. Five deals per round.')],
      [T('Empty columns'), T('Any run may rest in an empty column. They are your work space.')],
      [T('Controls'), T('Tap or click a card to lift its run, then tap a destination. Keyboard: {move} move focus, {confirm} lifts/drops, {deal} deals, {hint} hints, {undo} undoes, {pause} pauses.', {
        move: ['left', 'right', 'up', 'down'].map((a) => this.keyLabel(a)).join('/'), confirm: this.keyLabel('confirm'), deal: this.keyLabel('deal'),
        hint: this.keyLabel('hint'), undo: this.keyLabel('undo'), pause: this.keyLabel('pause'),
      })],
    ];
    for (const [t, d] of entries) {
      const c = el('div', 'help-card');
      c.append(el('strong', null, t), el('p', null, d));
      cards.append(c);
    }
    wrap.append(cards, this.button('← Back', () => this.show(this.session.state ? 'play' : 'modes')));
    this.overlay.append(wrap);
  }

  // --- Round start ------------------------------------------------------------
  startRound(def) {
    this.hintMove = null;
    this._timeWarned = false;
    this.session.startRound(def);
    this.show('play');
    this.syncBoard();
    if (def.mode === 'learn') {
      this.showLessonStep();
    } else {
      this.countdown();
    }
  }

  countdown() {
    const s = this.settings;
    if (s.reducedMotion) { this.session.beginActive(); this.syncBoard(); return; }
    let n = 3;
    const cd = el('div', 'countdown', String(n));
    this.overlay.innerHTML = '';
    this.overlay.append(cd);
    this.audio.event('tick');
    const step = () => {
      n -= 1;
      if (n <= 0) {
        this.overlay.innerHTML = '';
        this.session.beginActive();
        this.announce(T('Round started.') + ' ' + this.objectiveText());
        this.syncBoard();
        return;
      }
      cd.textContent = String(n);
      this.audio.event('tick');
      this._cdT = setTimeout(step, 700);
    };
    this._cdT = setTimeout(step, 700);
  }

  showLessonStep() {
    const step = this.session.currentLessonStep();
    if (step) {
      this.announce(T(step.text));
      this.toast(T(step.text));
    }
  }

  toast(text, ms = 4000) {
    const t = el('div', 'toast', text);
    t.setAttribute('role', 'status');
    this.overlay.append(t);
    setTimeout(() => t.remove(), ms);
  }

  startDaily() {
    const def = dailyForDate(new Date());
    this.startRound(def);
  }

  // --- Play screen -------------------------------------------------------------
  screenPlay() {
    this.overlay.innerHTML = '';
    this.buildTopBar();
    this.rebuildTray();
    this.syncBoard();
    this.boardEl.focus();
  }

  buildTopBar() {
    this.topBar.innerHTML = '';
    const def = this.session.def;
    const title = el('span', 'top-title', def ? defTitle(def) : '');
    this.clockEl = el('span', 'top-clock', '');
    const menu = el('button', 'btn icon-btn', '☰');
    menu.setAttribute('aria-label', T('Pause menu'));
    menu.dataset.i18nAria = 'Pause menu';
    menu.addEventListener('click', (e) => { e.stopPropagation(); this.audio.ensure(); this.audio.event('select'); this.showPause(); });
    this.topBar.append(menu, title, this.clockEl);
    if (this.session.state) this.updateClock();
  }

  rebuildTray() {
    this.bottomTray.innerHTML = '';
    const assists = this.session.def?.assists || { hints: true, undo: true };
    this.btnUndo = this.button('Undo', () => this.doUndo());
    this.btnHint = this.button('Hint', () => this.doHint());
    this.btnDeal = this.button('Deal', () => this.doDeal(), 'btn btn-primary');
    if (!assists.undo) this.btnUndo.disabled = true;
    if (!assists.hints) this.btnHint.disabled = true;
    this.bottomTray.append(this.btnUndo, this.btnHint, this.btnDeal);
  }

  objectiveText() {
    const st = this.session.state;
    if (!st) return '';
    return T(st.webGoal > 1 ? N('Clear {goal} webs. {done}/{goal} done.') : N('Clear {goal} web. {done}/{goal} done.'), { goal: st.webGoal, done: st.foundations });
  }

  syncRails() {
    const st = this.session.state;
    if (!st) return;
    this.objectiveEl.innerHTML = '';
    this.objectiveEl.append(
      el('p', null, this.objectiveText()),
      el('p', 'dim', T('{hidden} cards hidden · stock deals left: {deals}', { hidden: faceDownCount(st), deals: st.stock.length })),
    );
    this.progressEl.innerHTML = '';
    const s = st.score;
    this.progressEl.append(el('p', null,
      T('Score {total}  (base {base} − moves {moves} + webs {webs} + time {time} + no-undo {noUndo})', {
        total: s.total, base: s.base, moves: -s.movePenalty, webs: s.runs, time: s.time, noUndo: s.noUndo,
      })));
    this.progressEl.append(el('p', 'dim', T('Moves {moves} · Invalid {invalid}', {
      moves: `${st.moves}${st.limits.moves ? '/' + st.limits.moves : ''}`, invalid: st.invalid,
    })));
    this.statusEl.innerHTML = '';
    this.statusEl.append(el('p', null, st.status === 'active' ? T('Your move') : T(STATUS_TEXT[st.status] || st.status.toUpperCase())));
  }

  // --- Board rendering (DOM mirror of the 3D scene) ----------------------------
  syncBoard() {
    const st = this.session.state;
    if (!st || !this.renderer) return;
    this.syncRails();
    const W = this.playfield.clientWidth || 800;
    const H = this.playfield.clientHeight || 600;
    const L = computeLayout(st, W, H, { coarse: window.matchMedia('(pointer: coarse)').matches });
    this.layout = L;
    this.renderer.sync(st);

    // Rebuild DOM card layer (cheap; bounded to 104 buttons).
    this.boardEl.innerHTML = '';
    const theme = getTheme(this.settings.theme);

    // Stock packets
    st.stock.forEach((_, i) => {
      const b = el('button', 'stock-packet');
      Object.assign(b.style, posStyle(L.stock[i]));
      b.setAttribute('aria-label', T('Stock packet {n}. Deal one card to every column.', { n: i + 1 }));
      if (i === st.stock.length - 1) { // only the top packet carries the label
        const label = T('deal');
        b.dataset.label = label;
        // Too narrow for the word (small screens, long translations): set it beside the pile.
        b.classList.toggle('label-out', label.length * 9.5 > L.stock[i].w - 6);
      }
      b.addEventListener('click', () => this.doDeal());
      this.boardEl.append(b);
    });
    // Foundations
    for (let i = 0; i < st.foundations; i++) {
      const f = el('div', 'foundation filled');
      Object.assign(f.style, posStyle(L.foundations[i]));
      f.textContent = '🕸';
      f.setAttribute('aria-label', T('Web {n} complete', { n: i + 1 }));
      this.boardEl.append(f);
    }
    // Column pads (empty-column drop targets)
    L.pads.forEach((p, c) => {
      if (st.cols[c].length) return;
      const pad = el('button', 'col-pad');
      Object.assign(pad.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
      pad.dataset.col = c;
      pad.setAttribute('aria-label', T('Column {n} (empty)', { n: c + 1 }));
      pad.addEventListener('click', () => this.tapPad(c));
      this.boardEl.append(pad);
    });
    // Cards
    st.cols.forEach((col, c) => {
      col.forEach((cd, i) => {
        const b = el('button', 'card');
        const r = L.cols[c][i];
        Object.assign(b.style, posStyle(r));
        b.style.zIndex = i + 1;
        b.dataset.col = c; b.dataset.idx = i;
        if (cd.u) {
          const suit = this.suits[cd.s];
          b.classList.add('face-up');
          b.style.setProperty('--suit', suit.color);
          b.innerHTML = `<span class="rank">${rankLabel(cd.r)}</span><span class="glyph" aria-hidden="true">${suit.glyph}</span>`;
          const runLen = col.length - i;
          b.setAttribute('aria-label',
            T('Column {n}: {rank} of {suit}', { n: c + 1, rank: rankLabel(cd.r), suit: T(suit.name) }) +
            (runLen > 1 ? T(', run of {n}', { n: runLen }) : ''));
        } else {
          b.classList.add('face-down');
          b.setAttribute('aria-label', T('Column {n}: face-down card', { n: c + 1 }));
          b.disabled = true;
        }
        if (this.session.selection && this.session.selection.from === c && i >= this.session.selection.idx) {
          b.classList.add('selected');
        }
        if (this.hintMove && this.hintMove.from === c && i >= this.hintMove.idx) b.classList.add('hinted');
        if (this.focusCard && this.focusCard.col === c && this.focusCard.idx === i) b.classList.add('kbd-focus');
        b.addEventListener('pointerdown', (e) => this.onCardPointerDown(e, c, i));
        b.addEventListener('click', (e) => { if (!this._dragged) this.tapCard(c, i); this._dragged = false; });
        this.boardEl.append(b);
      });
    });
    // Legal target highlight while a run is lifted
    if (this.session.selection) {
      for (const to of this.session.legalTargets()) {
        const p = L.pads[to];
        const hl = el('div', 'target-hl');
        Object.assign(hl.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
        this.boardEl.append(hl);
      }
    }
    this.renderer.setSelection(this.session.selection, this.session.selection ? this.session.legalTargets() : [], this.hintMove);
    if (this.btnDeal) {
      this.btnDeal.disabled = st.stock.length === 0;
      this.btnDeal.title = st.stock.length === 0 ? T('The stock is empty') : '';
    }
    this.updateClock();
  }

  // --- Input ------------------------------------------------------------------
  bindInput() {
    this.playfield.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.playfield.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.playfield.addEventListener('pointercancel', () => { this.drag = null; });
    this.boardEl.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('keydown', (e) => {
      if (this.screen !== 'play' || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = this.keyAction[e.code];
      if (a === 'pause') { e.preventDefault(); this.escPressed(); }
      else if (a === 'deal') this.doDeal();
      else if (a === 'hint') this.doHint();
      else if (a === 'undo') this.doUndo();
    });
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.session.background(); this.audio.suspend(); this.renderer?.setHidden(true); }
      else { this.audio.resume(); this.renderer?.setHidden(false); }
    });
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 120));
    // Gamepad: focus navigation + primary/secondary + pause.
    this._padPrev = {};
    const poll = () => {
      const pads = navigator.getGamepads?.() || [];
      const gp = pads[0];
      if (gp && this.screen === 'play') {
        const pressed = (i) => gp.buttons[i]?.pressed && !this._padPrev[i];
        if (pressed(14)) this.moveFocus(-1, 0);
        if (pressed(15)) this.moveFocus(1, 0);
        if (pressed(12)) this.moveFocus(0, -1);
        if (pressed(13)) this.moveFocus(0, 1);
        if (pressed(0)) this.confirmFocus();
        if (pressed(1)) this.escPressed();
        if (pressed(9)) this.showPause();
        this._padPrev = Object.fromEntries(gp.buttons.map((b, i) => [i, b.pressed]));
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  onResize() {
    this.renderer?.resize();
    if (this.session.state && this.screen === 'play') this.syncBoard();
  }

  onCardPointerDown(e, col, idx) {
    if (!this.session.inRound()) return;
    this.audio.ensure();
    this.drag = { col, idx, x0: e.clientX, y0: e.clientY, active: false };
    e.target.setPointerCapture?.(e.pointerId);
  }

  onPointerMove(e) {
    if (!this.drag || this.drag.active) {
      if (this.drag?.active) this.dragHover(e);
      return;
    }
    const dx = e.clientX - this.drag.x0, dy = e.clientY - this.drag.y0;
    if (Math.hypot(dx, dy) > 12) { // distance threshold: tap vs drag
      const st = this.session;
      if (st.selection === null) st.tapCard(this.drag.col, this.drag.idx);
      if (st.selection) { this.drag.active = true; this.syncBoard(); }
    }
  }

  dragHover(e) {
    const elAt = document.elementFromPoint(e.clientX, e.clientY);
    const col = elAt?.dataset?.col ?? elAt?.closest?.('.col-pad');
    // preview: highlight handled via legal target layer; nothing extra needed
  }

  onPointerUp(e) {
    if (!this.drag) return;
    const wasActive = this.drag.active;
    this.drag = null;
    if (!wasActive) return;
    this._dragged = true;
    const elAt = document.elementFromPoint(e.clientX, e.clientY);
    const target = elAt?.closest?.('[data-col]'); // spans inside cards count as their card
    const tcol = target?.dataset?.col != null ? Number(target.dataset.col) : null;
    if (tcol != null) {
      if (tcol === this.session.selection?.from) {
        // Dropped back on its origin: set the run down quietly.
        this.session.selection = null;
        this.audio.event('deselect');
      } else {
        this.session.commitMove(tcol); // covers cards and empty-column pads alike
      }
      this.afterAction();
    }
    // Dropped over no column: the run stays lifted so the player can re-aim.
  }

  onKey(e) {
    if (this.screen !== 'play') return;
    const map = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    const a = this.keyAction[e.code];
    if (map[a]) { e.preventDefault(); this.moveFocus(...map[a]); }
    else if (a === 'confirm') { e.preventDefault(); this.confirmFocus(); }
  }

  moveFocus(dx, dy) {
    const st = this.session.state;
    if (!st) return;
    if (!this.focusCard) {
      // start on the first face-up top card
      for (let c = 0; c < 10; c++) if (st.cols[c].length) { this.focusCard = { col: c, idx: st.cols[c].length - 1 }; break; }
      if (!this.focusCard) this.focusCard = { col: 0, idx: 0 };
    } else if (dx !== 0) {
      let c = this.focusCard.col;
      for (let k = 0; k < 10; k++) {
        c = (c + dx + 10) % 10;
        if (st.cols[c].length) { this.focusCard = { col: c, idx: Math.min(this.focusCard.idx, st.cols[c].length - 1) }; break; }
      }
    } else {
      const col = st.cols[this.focusCard.col];
      this.focusCard.idx = Math.max(0, Math.min(col.length - 1, this.focusCard.idx + (dy > 0 ? 1 : -1)));
    }
    this.syncBoard();
    const btn = this.boardEl.querySelector(`[data-col="${this.focusCard.col}"][data-idx="${this.focusCard.idx}"]`);
    btn?.focus();
  }

  confirmFocus() {
    if (!this.focusCard) return this.moveFocus(0, 0);
    this.tapCard(this.focusCard.col, this.focusCard.idx);
  }

  escPressed() {
    if (this.session.selection) {
      this.session.selection = null;
      this.hintMove = null;
      this.audio.event('deselect');
      this.syncBoard();
    } else if (this.session.inRound()) {
      this.showPause();
    } else if (this.session.machine === 'paused' && !this.overlay.querySelector('.modal')) {
      this.showPause(); // paused with the modal dismissed (backdrop click): reopen it
    }
  }

  tapCard(col, idx) {
    if (!this.session.inRound()) return;
    this.hintMove = null;
    const before = this.session.selection;
    const r = this.session.tapCard(col, idx);
    if (!r.error && before === null && this.session.selection) this.audio.event('select');
    this.haptic(8);
    this.afterAction();
  }

  tapPad(col) {
    const r = this.session.tapColumnPad(col);
    if (r.error === 'not-empty' || r.error === 'no-selection') return;
    this.afterAction();
  }

  doDeal() {
    if (!this.session.inRound()) return;
    this.hintMove = null;
    const r = this.session.deal();
    if (r?.error) { this.toast(reasonText(r.error), 2500); this.announce(reasonText(r.error)); }
    this.afterAction();
    return r;
  }

  doUndo() {
    const r = this.session.undo();
    if (!r.error) { this.audio.event('undo'); this.announce(T('Move undone.')); this.syncBoard(); }
  }

  doHint() {
    const h = this.session.hint();
    if (h && !h.error) {
      this.hintMove = h;
      this.audio.event('hint');
      const suit = this.suits[this.session.state.cols[h.from][h.idx].s];
      this.announce(T('Hint: move the {rank} of {suit} from column {from} to column {to}.', {
        rank: rankLabel(this.session.state.cols[h.from][h.idx].r), suit: T(suit.name), from: h.from + 1, to: h.to + 1,
      }));
      this.syncBoard();
      setTimeout(() => { this.hintMove = null; if (this.screen === 'play') this.clearHintMarks(); }, 3500);
    } else if (h?.none) {
      this.announce(T(h.canDeal ? N('No moves — deal from the stock.') : N('No legal moves remain.')));
      this.toast(T(h.canDeal ? N('No moves available — deal from the stock.') : N('No legal moves remain.')));
    } else if (h?.error) {
      this.toast(reasonText(h.error), 2500);
    }
  }

  // The hint's dashes end in place: rebuilding the card layer here would
  // replace a card the player is pressing, and a click only fires when press
  // and release land on the same element.
  clearHintMarks() {
    for (const b of this.boardEl.querySelectorAll('.card.hinted')) b.classList.remove('hinted');
    if (this.session.state && this.renderer) {
      this.renderer.setSelection(this.session.selection, this.session.selection ? this.session.legalTargets() : [], this.hintMove);
    }
  }

  afterAction() {
    this.syncBoard();
    const st = this.session.state;
    if (st?.status === 'active') this.session.saveSnapshot();
  }

  updateClock() {
    clearInterval(this._clockI);
    const tickClock = () => {
      const st = this.session.state;
      if (!st || !this.clockEl) return;
      const ms = this.session.nowMs();
      const mm = Math.floor(ms / 60000), ss = Math.floor((ms % 60000) / 1000);
      let txt = `${mm}:${String(ss).padStart(2, '0')}`;
      if (st.limits.timeMs != null) {
        const left = Math.max(0, st.limits.timeMs - ms);
        const lm = Math.floor(left / 60000), ls = Math.floor((left % 60000) / 1000);
        txt = `⏱ ${lm}:${String(ls).padStart(2, '0')}`;
        this.clockEl.classList.toggle('urgent', left < 60000);
        if (left < 60000 && left > 0 && !this._timeWarned && st.status === 'active' && this.session.machine === 'active') {
          this._timeWarned = true; // one-shot per round
          this.audio.event('time-warning');
          this.announce(T('One minute left.'));
        }
        if (left <= 0 && st.status === 'active' && this.session.machine === 'active') {
          // The clock expired between inputs: route a heartbeat through the
          // rules engine so the time-limit loss lands authoritatively.
          this.session.dispatch({ type: 'note' });
          return;
        }
      }
      this.clockEl.textContent = txt;
    };
    tickClock();
    this._clockI = setInterval(tickClock, 1000);
  }

  // --- Pause / settings ---------------------------------------------------------
  showPause(restored = false) {
    if (this.session.inRound() || this.session.machine === 'paused') this.session.pause('user');
    this.audio.event('pause');
    this.syncBoard();
    this.modal('Paused', (body, close) => {
      const resume = this.button('Resume', () => { close(); this.session.resume(); this.syncBoard(); }, 'btn btn-primary btn-big');
      body.append(resume);
      if (restored) body.append(tx('p', 'dim', 'Round restored from your last safe snapshot.'));
      body.append(
        this.settingsSection(),
        this.button('Help', () => { close(); this.screenHelp(); }),
        this.button('Restart round', () => { close(); this.startRound(this.session.def); }),
        this.button('Give up', () => { close(); this.session.giveUp(); }, 'btn btn-danger'),
        this.button('Leave to title', () => { close(); this.session.pause('leave'); this.session.saveSnapshot(); this.show('title'); }),
      );
      resume.focus();
    });
  }

  settingsSection() {
    const s = this.settings;
    const wrap = el('fieldset', 'settings');
    wrap.append(tx('legend', null, 'Settings'));
    const row = (label, input) => {
      const l = el('label', 'setting-row');
      const sp = tx('span', null, label);
      l.append(sp, input);
      wrap.append(l);
      return input;
    };
    const slider = (label, key) => {
      const i = el('input');
      i.type = 'range'; i.min = 0; i.max = 1; i.step = 0.05; i.value = s[key];
      i.addEventListener('input', () => { s[key] = Number(i.value); this.applySettings(); });
      row(label, i);
    };
    const toggle = (label, key, cb) => {
      const i = el('input');
      i.type = 'checkbox'; i.checked = !!s[key];
      i.addEventListener('change', () => { s[key] = i.checked; this.applySettings(); cb?.(); });
      row(label, i);
    };
    const select = (label, key, options, cb) => {
      const sel = el('select');
      for (const [v, name] of options) {
        const o = tx('option', null, name); o.value = v; sel.append(o);
      }
      sel.value = s[key];
      sel.addEventListener('change', () => { s[key] = sel.value; this.applySettings(); cb?.(); });
      row(label, sel);
    };
    slider(N('Music volume'), 'volMusic');
    slider(N('Effects volume'), 'volEffects');
    slider(N('Ambience volume'), 'volAmbience');
    slider(N('Voice volume'), 'volVoice');
    toggle(N('Mute all'), 'muted');
    select(N('Theme'), 'theme', THEMES.map((t) => [t.id, t.name]), () => this.syncBoard());
    select(N('Color-vision palette'), 'cvd', [['none', N('Default')], ['deuter', N('Deuteranopia-safe')], ['protan', N('Protanopia-safe')], ['tritan', N('Tritanopia-safe')]], () => this.syncBoard());
    toggle(N('Reduced motion'), 'reducedMotion');
    toggle(N('High contrast'), 'highContrast');
    toggle(N('Larger text'), 'largeText');
    toggle(N('Left-handed controls'), 'leftHanded');
    toggle(N('Hold to drag (vs tap)'), 'holdToDrag');
    toggle(N('Haptics'), 'haptics');
    wrap.append(this.graphicsSection());
    return wrap;
  }

  // Settings from the title screen (in a round, the pause modal holds them).
  showSettings() {
    this.modal(N('Settings'), (body, close) => {
      body.append(this.settingsSection(), this.button(N('Close'), () => close(), 'btn btn-primary'));
    }, { keep: true });
  }

  // Graphics: quality preset, render scale, per-effect overrides, adaptive
  // resolution, frame-rate readout and a cost summary. Applies live.
  graphicsSection() {
    let G = gfxStrings();
    const s = this.settings;
    const wrap = el('fieldset', 'settings gfx-settings');
    wrap.id = 'gfx-section';
    const legend = el('legend', null, G.graphics);
    wrap.append(legend);
    const tierName = (t) => G.tiers[t] || G.presets[t] || t;
    const info = () => this.renderer?.graphicsInfo?.() || {
      ok: false, gpu: '', detected: 'balanced', resolved: resolveGfx(s.graphics, 'balanced'), summary: '', postFailed: false,
    };
    const labels = []; // [span, () => text] relabelled on a language change
    const row = (label, control, id) => {
      const l = el('label', 'setting-row');
      l.htmlFor = id;
      const span = el('span', null, label());
      labels.push([span, label]);
      l.append(span, control);
      wrap.append(l);
    };
    const commit = () => {
      this.applySettings();
      refresh();
      setTimeout(refresh, 200); // pixel size / post chain settle on the next frames
    };
    const opt = (sel, value, text) => { const o = el('option', null, text); o.value = value; sel.append(o); return o; };

    const preset = el('select');
    preset.id = 'gfx-preset'; preset.dataset.gfx = 'preset';
    const autoOpt = opt(preset, 'auto', '');
    const presetOpts = PRESETS.map((p) => opt(preset, p, G.presets[p]));
    preset.addEventListener('change', () => { s.graphics = choosePreset(s.graphics, preset.value); commit(); });
    row(() => G.quality, preset, 'gfx-preset');

    const scaleBox = el('span', 'gfx-range');
    const scale = el('input');
    scale.type = 'range'; scale.min = 50; scale.max = 200; scale.step = 5;
    scale.id = 'gfx-scale'; scale.dataset.gfx = 'render_scale';
    const scaleOut = el('output', 'gfx-range-value');
    scaleOut.id = 'gfx-scale-value';
    scaleBox.append(scale, scaleOut);
    scale.addEventListener('input', () => {
      s.graphics = { ...s.graphics, render_scale: Number(scale.value) / 100 };
      scaleOut.textContent = `${scale.value}%`;
      commit();
    });
    row(() => G.renderScale, scaleBox, 'gfx-scale');

    const catSel = {};
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      const sel = el('select');
      sel.id = `gfx-${cat}`; sel.dataset.gfx = cat;
      opt(sel, 'preset', '');
      for (const t of tiers) opt(sel, t, tierName(t)).dataset.tier = t;
      sel.addEventListener('change', () => {
        const g = { ...s.graphics };
        if (sel.value === 'preset') delete g[cat]; else g[cat] = sel.value;
        s.graphics = g;
        commit();
      });
      catSel[cat] = sel;
      row(() => G.cats[cat] || cat, sel, sel.id);
    }

    const check = (label, key, id, def) => {
      const i = el('input');
      i.type = 'checkbox'; i.id = id; i.dataset.gfx = key;
      i.checked = def ? s.graphics[key] !== false : !!s.graphics[key];
      i.addEventListener('change', () => { s.graphics = { ...s.graphics, [key]: i.checked }; commit(); });
      row(label, i, id);
      return i;
    };
    const adaptive = check(() => G.adaptive, 'adaptive', 'gfx-adaptive', true);
    const fps = check(() => G.showFps, 'show_fps', 'gfx-fps', false);

    const summary = el('p', 'dim gfx-summary');
    summary.id = 'gfx-summary';
    summary.setAttribute('aria-live', 'polite');
    const note = el('p', 'gfx-note');
    note.id = 'gfx-note';
    wrap.append(summary, note);

    const refresh = () => {
      const i = info();
      const q = i.resolved;
      autoOpt.textContent = fmt(G.auto, { tier: G.presets[i.detected] || i.detected });
      preset.value = PRESETS.includes(s.graphics.preset) ? s.graphics.preset : 'auto';
      const pct = Math.round((Number(s.graphics.render_scale) || 1) * 100);
      scale.value = pct; scaleOut.textContent = `${pct}%`;
      for (const [cat, sel] of Object.entries(catSel)) {
        sel.options[0].textContent = fmt(G.fromPreset, { tier: tierName(presetTier(q.preset, cat)) });
        sel.value = CATEGORIES[cat].includes(s.graphics[cat]) ? s.graphics[cat] : 'preset';
      }
      adaptive.checked = s.graphics.adaptive !== false;
      fps.checked = !!s.graphics.show_fps;
      const gpu = i.gpu === 'unknown GPU' ? T('unknown GPU') : i.gpu;
      const cost = i.resolved ? describeGfx(i.resolved, i.pixels || null, T) : i.summary;
      summary.textContent = [gpu, i.ok ? fmt(G.level, { n: i.level ?? 0 }) : null, cost].filter(Boolean).join(' · ');
      const msg = !i.ok ? G.noWebgl : i.postFailed ? G.postFailed : '';
      note.textContent = msg;
      note.hidden = !msg;
    };
    refresh();
    // Language change: swap the strings in place (the shared option sections
    // that game-options.js mounts inside this fieldset stay put).
    wrap._relabel = () => {
      G = gfxStrings();
      legend.textContent = G.graphics;
      for (const [span, label] of labels) span.textContent = label();
      presetOpts.forEach((o, k) => { o.textContent = G.presets[PRESETS[k]]; });
      for (const sel of Object.values(catSel)) for (const o of sel.options) if (o.dataset.tier) o.textContent = tierName(o.dataset.tier);
      refresh();
    };
    return wrap;
  }

  // --- Session events -------------------------------------------------------------
  onEvent(e) {
    switch (e.type) {
      case 'game-event': {
        const ev = e.event;
        if (ev.type === 'move') this.audio.event('move');
        else if (ev.type === 'flip') this.audio.event('flip');
        else if (ev.type === 'deal') this.audio.event('deal');
        else if (ev.type === 'run-complete') {
          this.audio.event('run-complete');
          this.announce(T('Web complete! {done} of {goal}.', { done: e.state.foundations, goal: e.state.webGoal }));
        } else if (ev.type === 'invalid') {
          this.audio.event('invalid');
          this.announce(T('Not legal: {reason}.', { reason: reasonText(ev.reason) }));
          this.toast(T('Not legal: {reason}.', { reason: reasonText(ev.reason) }), 2500);
        } else if (ev.type === 'win') this.audio.event('win');
        else if (ev.type === 'lose') this.audio.event('lose');
        this.renderer?.eventFx(ev);
        break;
      }
      case 'invalid': {
        this.audio.event('invalid');
        this.toast(T('Not legal: {reason}.', { reason: reasonText(e.reason) }), 2500);
        this.announce(T('Not legal: {reason}.', { reason: reasonText(e.reason) }));
        break;
      }
      case 'select': this.syncBoard(); break;
      case 'lesson-step': {
        if (e.step) { this.audio.event('lesson-step'); this.toast(T(e.step.text), 6000); this.announce(T(e.step.text)); }
        else this.toast(T('Lesson complete when the web clears!'), 3000);
        break;
      }
      case 'lesson-blocked': {
        const msg = e.stepText ? T('Follow the lesson: {step}', { step: T(e.stepText) }) : e.message;
        this.toast(msg, 3000); this.announce(msg); break;
      }
      case 'while-away': {
        const a = e.away;
        const msg = a ? T('Round restored. You were away {min} min; {webs}/{goal} webs cleared, score {score}.', a) : e.summary;
        this.toast(msg, 6000); this.announce(msg); break;
      }
      case 'round-end': this.onRoundEnd(); break;
    }
  }

  onRoundEnd() {
    const st = this.session.state;
    const def = this.session.def;
    clearInterval(this._clockI);
    // Progression + achievements (idempotent).
    const won = st.status === 'won';
    const newly = [];
    const grant = (key) => { if (!this.progress.achievements[key]) { this.progress.achievements[key] = Date.now(); newly.push(key); } };
    if (won) {
      if (def.mode === 'journey') this.progress.journey[def.id] = { score: st.score.total, at: Date.now() };
      if (def.goals?.mastery) { this.progress.mastery[def.id] = true; grant('mastery_stage'); }
      if (def.mode === 'learn') this.progress.lessonsDone[def.id] = true;
      const day = new Date().toISOString().slice(0, 10);
      if (!this.progress.daysPlayed.includes(day)) this.progress.daysPlayed.push(day);
      if (this.progress.daysPlayed.length >= 5) grant('streak_5');
      if (st.foundations > 0) grant('first_web');
    }
    this.progress.websCleared += st.foundations;
    if (this.progress.websCleared >= 100) grant('hundred_webs');
    if (this.session.toolTallies.deal > 0 && this.session.toolTallies.empty > 0 && this.session.toolTallies.run > 0 && won) grant('mechanic_master');
    const best = this.progress.bests[def.id];
    if (won && (!best || st.score.total > best)) this.progress.bests[def.id] = st.score.total;
    this.history.push({
      contentId: def.id, mode: def.mode, status: st.status, at: Date.now(),
      score: { ...st.score }, moves: st.moves, foundations: st.foundations,
    });
    if (this.history.length > 50) this.history.shift();
    this.saveProgress();
    this.platform.saveLocal(HISTORY_KEY, this.history);

    const headlineKey = won ? N('All webs cleared!') : st.status === 'aborted' ? N('Round abandoned') : N('The weave holds…');
    const headline = () => (won ? '🕸 ' : '') + T(headlineKey);
    this.postToLeaderboard(def, st);
    this.modal(headline, (body, close) => {
      const s = st.score;
      const art = el('img', 'results-art');
      art.src = won ? 'assets/results-win.webp' : 'assets/results-over.webp';
      art.alt = ''; art.decoding = 'async';
      art.addEventListener('error', () => art.remove()); // decorative: vanish if missing
      body.append(art);
      const table = el('dl', 'score-breakdown');
      const rows = [
        [N('Base'), s.base], [N('Moves'), s.movePenalty], [N('Webs'), `+${s.runs}`],
        [N('Time bonus'), `+${s.time}`], [N('No-undo bonus'), `+${s.noUndo}`], [N('Total'), s.total],
      ];
      for (const [k, v] of rows) { table.append(el('dt', null, T(k)), el('dd', null, String(v))); }
      body.append(table);
      const clock = `${Math.floor(st.elapsedMs / 60000)}:${String(Math.floor(st.elapsedMs / 1000) % 60).padStart(2, '0')}`;
      body.append(el('p', 'dim', T('{moves} moves · {invalid} invalid · {time}', { moves: st.moves, invalid: st.invalid, time: clock }) +
        (st.terminalReason ? ' · ' + T(TERMINAL_TEXT[st.terminalReason] || st.terminalReason) : '')));
      if (this._lb) {
        const line = el('p', 'dim results-lb', this.lbText());
        line.id = 'results-lb';
        line.setAttribute('role', 'status');
        body.append(line);
      }
      if (newly.length) {
        const ach = el('div', 'achievements');
        for (const k of newly) {
          const a = ACHIEVEMENTS.find((x) => x.key === k);
          ach.append(el('p', 'achievement', `🏅 ${a ? T(a.name) : k} — ${a ? T(a.desc) : ''}`));
        }
        body.append(ach);
      }
      const next = this.nextRecommended();
      body.append(
        this.button('Retry', () => { close(); this.startRound(def); }, 'btn btn-primary'),
        this.button(next.label, () => { close(); next.fn(); }),
        this.button('Title', () => { close(); this.show('title'); }),
      );
    }, { live: true });
    if (newly.length) {
      setTimeout(() => this.audio.event('achievement'), 700); // after the win/lose sting
      this.announce(T('Achievement unlocked: {names}', {
        names: newly.map((k) => { const a = ACHIEVEMENTS.find((x) => x.key === k); return a ? T(a.name) : k; }).join(', '),
      }));
    }
    this.announce(T('{headline} Final score {total}.', { headline: T(headlineKey), total: st.score.total }));
  }

  // Signed-in ranked rounds that finished (won or lost, not given up): post the
  // total to the StarHermit high-score board and show the player's rank there.
  // The line's state is kept so a language change can re-render it.
  postToLeaderboard(def, st) {
    const seq = (this._lbSeq = (this._lbSeq || 0) + 1);
    this._lb = null;
    if (!def.ranked || st.status === 'aborted' || !this.platform.tokenHosted) return;
    this._lb = { status: 'posting', rank: null };
    this.platform.submitScore(st.score.total).then((r) => {
      if (seq !== this._lbSeq) return;
      this._lb = { status: r.posted ? 'posted' : 'not-posted', rank: r.rank || null };
      const line = this.overlay.querySelector('#results-lb');
      if (line) line.textContent = this.lbText();
    });
  }

  lbText() {
    const lb = this._lb;
    if (!lb) return '';
    if (lb.status === 'posting') return T('Posting score to the leaderboard…');
    if (lb.status === 'not-posted') return T('Score not posted to the leaderboard.');
    return lb.rank ? T('Leaderboard rank: #{rank}', { rank: lb.rank }) : T('Score posted to the leaderboard.');
  }

  nextRecommended() {
    const def = this.session.def;
    if (def.mode === 'journey') {
      const idx = JOURNEY.findIndex((j) => j.id === def.id);
      if (idx >= 0 && idx + 1 < JOURNEY.length) {
        return { label: N('Next stage'), fn: () => this.startRound(JOURNEY[idx + 1]) };
      }
    }
    if (def.mode === 'learn') {
      const idx = LESSONS.findIndex((l) => l.id === def.id);
      if (idx >= 0 && idx + 1 < LESSONS.length) {
        return { label: N('Next lesson'), fn: () => this.startRound(LESSONS[idx + 1]) };
      }
    }
    return { label: N('Journey'), fn: () => this.show('journey') };
  }
}

function posStyle(r) {
  return { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' };
}

const REASON_TEXT = {
  'same-column': N('that is the same column'),
  'face-down': N('that card is face-down'),
  'broken-run': N('only same-thread descending runs travel together'),
  'rank-mismatch': N('a run rests only on the next rank up'),
  'empty-column': N('you cannot deal while a column is empty'),
  'round-over': N('the round is over'),
  'out-of-bounds': N('off the table'),
  'stock-empty': N('the stock is empty'),
  'hints-disabled': N('hints are disabled for this round'),
};
export function reasonText(reason) {
  return REASON_TEXT[reason] ? T(REASON_TEXT[reason]) : reason;
}
