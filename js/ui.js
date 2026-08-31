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

const SETTINGS_KEY = 'eightwebs:settings';
const PROGRESS_KEY = 'eightwebs:progress';
const HISTORY_KEY = 'eightwebs:history';

export const DEFAULT_SETTINGS = {
  theme: 'shadowbox',
  tier: 'medium',
  muted: false, volMusic: 0.6, volEffects: 0.8, volAmbience: 0.4, volVoice: 0.8,
  reducedMotion: false, highContrast: false, largeText: false,
  leftHanded: false, holdToDrag: false, haptics: true, cvd: 'none', // none|deuter|protan|tritan
  cameraPreset: 'table',
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

export class UI {
  constructor(root, session, platform, renderer, audio) {
    this.root = root;
    this.session = session;
    this.platform = platform;
    this.renderer = renderer;
    this.audio = audio;
    this.settings = { ...DEFAULT_SETTINGS, ...(platform.loadLocal(SETTINGS_KEY) || {}) };
    this.progress = platform.loadLocal(PROGRESS_KEY) || {
      v: 1, journey: {}, lessonsDone: {}, achievements: {}, websCleared: 0,
      daysPlayed: [], bests: {}, mastery: {},
    };
    this.history = platform.loadLocal(HISTORY_KEY) || [];
    this.screen = 'title';
    this.focusCard = null; // {col, idx} keyboard cursor
    this.drag = null;
    this.hintMove = null;
    this.suits = this.themedSuits();
    this.build();
    this.applySettings();
  }

  themedSuits() {
    const cvd = CVD_SUIT_COLORS[this.settings.cvd];
    return SUITS.map((s, i) => ({ ...s, color: cvd ? cvd[i] : s.color }));
  }

  saveSettings() { this.platform.saveLocal(SETTINGS_KEY, this.settings); }
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
    this.boardEl.setAttribute('aria-label', 'Eight Webs card table. Use arrow keys to move between cards, Enter to pick up or drop a run, D to deal, H for a hint, U to undo, Escape for pause.');
    this.boardEl.tabIndex = 0;
    this.playfield.append(this.boardEl);

    this.railLeft = el('aside', 'rail rail-left');
    this.railLeft.innerHTML = '<h2 class="rail-title">Objective</h2>';
    this.objectiveEl = el('div', 'objective');
    this.progressEl = el('div', 'progress-rail');
    this.railLeft.append(this.objectiveEl, this.progressEl);

    this.railRight = el('aside', 'rail rail-right');
    this.statusEl = el('div', 'status-rail');
    this.actionsEl = el('div', 'actions-rail');
    this.railRight.append(this.statusEl, this.actionsEl);

    this.topBar = el('header', 'top-bar');
    this.bottomTray = el('nav', 'bottom-tray');
    this.bottomTray.setAttribute('aria-label', 'Round actions');

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
    this.captionEl.textContent = `♪ ${text}`;
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
    this.renderer?.setTier(s.tier);
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

  modal(titleText, buildBody, { onClose } = {}) {
    this.overlay.innerHTML = '';
    const wrap = el('div', 'modal-wrap');
    const modal = el('section', 'modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const h = el('h2', null, titleText);
    modal.append(h);
    const body = el('div', 'modal-body');
    buildBody(body, () => close());
    modal.append(body);
    wrap.append(modal);
    this.overlay.append(wrap);
    const prevFocus = document.activeElement;
    const close = () => {
      this.overlay.innerHTML = '';
      prevFocus?.focus?.();           // focus restoration after every modal
      onClose?.();
    };
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    const first = modal.querySelector('button, [tabindex], input, select');
    (first || modal).tabIndex = -1;
    (first || modal).focus();
    return close;
  }

  button(label, onClick, cls = 'btn') {
    const b = el('button', cls, label);
    b.addEventListener('click', (e) => { e.stopPropagation(); this.audio.ensure(); this.audio.event('select'); onClick(); });
    return b;
  }

  // --- Title ----------------------------------------------------------------
  screenTitle() {
    this.overlay.innerHTML = '';
    const wrap = el('div', 'title-screen');
    const h1 = el('h1', null, 'Eight Webs');
    const tag = el('p', 'tagline', 'Weave descending runs of silk thread. Clear all eight webs.');
    const play = this.button('▶ Play', () => this.show('modes'), 'btn btn-primary btn-big');
    const row = el('div', 'title-row');
    row.append(
      this.button('Daily Challenge', () => this.startDaily()),
      this.button('Journey', () => this.show('journey')),
      this.button('Learn', () => this.show('lessons')),
      this.button('Scores', () => this.show('scores')),
      this.button('Help', () => this.show('help')),
    );
    const resume = this.session.hasSnapshot()
      ? this.button('Resume saved round', () => this.resumeSaved(), 'btn btn-accent')
      : null;
    const progress = el('p', 'title-progress',
      `Journey ${Object.keys(this.progress.journey).length}/${JOURNEY.length} · Webs cleared ${this.progress.websCleared}`);
    wrap.append(h1, tag, play, row);
    if (resume) wrap.append(resume);
    wrap.append(progress);
    this.overlay.append(wrap);
    play.focus();
  }

  resumeSaved() {
    const snap = this.session.restoreSnapshot();
    if (snap) { this.show('play'); this.syncBoard(); this.showPause(true); }
  }

  // --- Mode select -----------------------------------------------------------
  screenModes() {
    const wrap = el('div', 'menu-screen');
    wrap.append(el('h1', null, 'Choose a mode'));
    const grid = el('div', 'menu-grid');
    const modes = [
      ['Learn', 'Five short lessons. One rule at a time.', () => this.show('lessons')],
      ['Journey', 'Forty authored stages across five webs.', () => this.show('journey')],
      ['Daily', 'One shared seed per UTC day. Ranked.', () => this.startDaily()],
      ['Practice', 'Pick a difficulty. Unrated, free undo.', () => this.show('practice')],
      ['Challenge', 'Move budgets, clocks, restricted tools.', () => this.show('challenges')],
      ['Scores', 'Your history and the boards.', () => this.show('scores')],
    ];
    for (const [name, desc, fn] of modes) {
      const card = this.button('', fn, 'mode-card');
      card.append(el('strong', null, name), el('span', null, desc));
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
    card.append(
      el('strong', null, def.title),
      el('span', null, `${def.suits} thread${def.suits > 1 ? 's' : ''} · ${durMin ? `~${durMin} min clock` : 'untimed'}${def.limits.moves ? ` · ≤${def.limits.moves} moves` : ''}`),
      el('span', null, `Assists: ${def.assists.hints ? 'hints' : 'no hints'}, ${def.assists.undo ? 'undo' : 'no undo'} · ${def.ranked ? 'Ranked' : 'Unrated'}`),
      el('span', 'note', def.goals?.note || ''),
      this.button('Start', onStart, 'btn btn-primary'),
    );
    return card;
  }

  screenLessons() {
    const wrap = el('div', 'menu-screen');
    wrap.append(el('h1', null, 'Learn'));
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
    wrap.append(el('h1', null, 'Journey'));
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
    wrap.append(el('h1', null, 'Challenges'));
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
    wrap.append(el('h1', null, 'Practice'));
    const list = el('div', 'menu-list');
    PRACTICE_DIFFICULTIES.forEach((d) => {
      const def = practiceDef(d.id);
      list.append(this.setupCard(def, () => this.startRound(def)));
    });
    const seedRow = el('div', 'seed-row');
    const input = el('input');
    input.type = 'text'; input.placeholder = 'Custom seed (shareable)'; input.setAttribute('aria-label', 'Custom seed');
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
    wrap.append(el('h1', null, 'Scores & History'));
    const list = el('div', 'menu-list');
    if (!this.history.length) list.append(el('p', null, 'No completed rounds yet.'));
    for (const r of this.history.slice(-10).reverse()) {
      list.append(el('div', 'score-row',
        `${new Date(r.at).toLocaleDateString()} · ${r.contentId} — ${r.status === 'won' ? 'Won' : 'Lost'} · score ${r.score.total} (base ${r.score.base}, moves ${r.score.movePenalty}, webs +${r.score.runs}, time +${r.score.time}, no-undo +${r.score.noUndo})`));
    }
    const lb = el('div', 'menu-list');
    this.platform.api?.('/leaderboard/global').then?.(() => {}).catch?.(() => {});
    wrap.append(list, this.button('← Back', () => this.show('modes')));
    this.overlay.append(wrap);
  }

  screenHelp() {
    const wrap = el('div', 'menu-screen help');
    wrap.append(el('h1', null, 'How to play'));
    const cards = el('div', 'help-grid');
    const entries = [
      ['Build down', 'A card (or a whole same-thread descending run) rests on a card exactly one rank higher.'],
      ['Threads travel together', 'Only same-suit descending runs move as a group. Mixed stacks move one card at a time from the top.'],
      ['Clear webs', 'A complete King-to-Ace run of one thread lifts off the table. Clear eight webs to win.'],
      ['The stock', 'Deal adds one face-up card to every column — only when no column is empty. Five deals per round.'],
      ['Empty columns', 'Any run may rest in an empty column. They are your work space.'],
      ['Controls', 'Tap or click a card to lift its run, then tap a destination. Keyboard: arrows move focus, Enter lifts/drops, D deals, H hints, U undoes, Esc pauses.'],
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
        this.announce('Round started. ' + this.objectiveText());
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
      this.announce(step.text);
      this.toast(step.text);
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
    this.topBar.innerHTML = '';
    const def = this.session.def;
    const title = el('span', 'top-title', def?.title || '');
    this.clockEl = el('span', 'top-clock', '');
    this.topBar.append(
      this.button('☰', () => this.showPause(), 'btn icon-btn'),
      title, this.clockEl,
    );
    this.rebuildTray();
    this.syncBoard();
    this.boardEl.focus();
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
    return `Clear ${st.webGoal} web${st.webGoal > 1 ? 's' : ''}. ${st.foundations}/${st.webGoal} done.`;
  }

  syncRails() {
    const st = this.session.state;
    if (!st) return;
    this.objectiveEl.innerHTML = '';
    this.objectiveEl.append(
      el('p', null, this.objectiveText()),
      el('p', 'dim', `${faceDownCount(st)} cards hidden · stock deals left: ${st.stock.length}`),
    );
    this.progressEl.innerHTML = '';
    const s = st.score;
    this.progressEl.append(el('p', null,
      `Score ${s.total}  (base ${s.base} − moves ${-s.movePenalty} + webs ${s.runs} + time ${s.time} + no-undo ${s.noUndo})`));
    this.progressEl.append(el('p', 'dim', `Moves ${st.moves}${st.limits.moves ? '/' + st.limits.moves : ''} · Invalid ${st.invalid}`));
    this.statusEl.innerHTML = '';
    this.statusEl.append(el('p', null, st.status === 'active' ? 'Your move' : st.status.toUpperCase()));
  }

  // --- Board rendering (DOM mirror of the 3D scene) ----------------------------
  syncBoard() {
    const st = this.session.state;
    if (!st || !this.renderer) return;
    this.syncRails();
    const W = this.playfield.clientWidth || 800;
    const H = this.playfield.clientHeight || 600;
    const L = computeLayout(st, W, H);
    this.layout = L;
    this.renderer.sync(st);

    // Rebuild DOM card layer (cheap; bounded to 104 buttons).
    this.boardEl.innerHTML = '';
    const theme = getTheme(this.settings.theme);

    // Stock packets
    st.stock.forEach((_, i) => {
      const b = el('button', 'stock-packet');
      Object.assign(b.style, posStyle(L.stock[i]));
      b.setAttribute('aria-label', `Stock packet ${i + 1}. Deal one card to every column.`);
      b.addEventListener('click', () => this.doDeal());
      this.boardEl.append(b);
    });
    // Foundations
    for (let i = 0; i < st.foundations; i++) {
      const f = el('div', 'foundation filled');
      Object.assign(f.style, posStyle(L.foundations[i]));
      f.textContent = '🕸';
      f.setAttribute('aria-label', `Web ${i + 1} complete`);
      this.boardEl.append(f);
    }
    // Column pads (empty-column drop targets)
    L.pads.forEach((p, c) => {
      if (st.cols[c].length) return;
      const pad = el('button', 'col-pad');
      Object.assign(pad.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
      pad.setAttribute('aria-label', `Column ${c + 1} (empty)`);
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
            `Column ${c + 1}: ${rankLabel(cd.r)} of ${suit.name}` +
            (runLen > 1 ? `, run of ${runLen}` : ''));
        } else {
          b.classList.add('face-down');
          b.setAttribute('aria-label', `Column ${c + 1}: face-down card`);
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
    this.updateClock();
  }

  // --- Input ------------------------------------------------------------------
  bindInput() {
    this.playfield.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.playfield.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.playfield.addEventListener('pointercancel', () => { this.drag = null; });
    this.boardEl.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('keydown', (e) => {
      if (this.screen !== 'play') return;
      if (e.key === 'Escape') { e.preventDefault(); this.escPressed(); }
      if (e.key.toLowerCase() === 'd') { this.doDeal(); }
      if (e.key.toLowerCase() === 'h') { this.doHint(); }
      if (e.key.toLowerCase() === 'u') { this.doUndo(); }
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
    const { col, idx } = this.drag;
    this.drag = null;
    if (wasActive) {
      this._dragged = true;
      const elAt = document.elementFromPoint(e.clientX, e.clientY);
      const tcol = elAt?.dataset?.col != null ? Number(elAt.dataset.col) : null;
      if (tcol != null && tcol !== col) {
        this.session.selection = this.session.selection; // keep
        this.session.commitMove(tcol);
        this.afterAction();
      } else {
        const pad = elAt?.classList?.contains('col-pad');
        if (pad) { this.session.commitMove([...this.boardEl.querySelectorAll('.col-pad')].indexOf(elAt)); this.afterAction(); }
      }
    }
  }

  onKey(e) {
    if (this.screen !== 'play') return;
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (map[e.key]) { e.preventDefault(); this.moveFocus(...map[e.key]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.confirmFocus(); }
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
    this.afterAction();
    return r;
  }

  doUndo() {
    const r = this.session.undo();
    if (!r.error) { this.audio.event('undo'); this.announce('Move undone.'); this.syncBoard(); }
  }

  doHint() {
    const h = this.session.hint();
    if (h && !h.error) {
      this.hintMove = h;
      this.audio.event('hint');
      const suit = this.suits[this.session.state.cols[h.from][h.idx].s];
      this.announce(`Hint: move the ${rankLabel(this.session.state.cols[h.from][h.idx].r)} of ${suit.name} from column ${h.from + 1} to column ${h.to + 1}.`);
      this.syncBoard();
      setTimeout(() => { this.hintMove = null; if (this.screen === 'play') this.syncBoard(); }, 3500);
    } else if (h?.none) {
      this.announce(h.canDeal ? 'No moves — deal from the stock.' : 'No legal moves remain.');
      this.toast(h.canDeal ? 'No moves available — deal from the stock.' : 'No legal moves remain.');
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
      }
      this.clockEl.textContent = txt;
    };
    tickClock();
    this._clockI = setInterval(tickClock, 1000);
  }

  // --- Pause / settings ---------------------------------------------------------
  showPause(restored = false) {
    if (this.session.inRound() || this.session.machine === 'paused') this.session.pause('user');
    this.syncBoard();
    this.modal('Paused', (body, close) => {
      const resume = this.button('Resume', () => { close(); this.session.resume(); this.syncBoard(); }, 'btn btn-primary btn-big');
      body.append(resume);
      if (restored) body.append(el('p', 'dim', 'Round restored from your last safe snapshot.'));
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
    wrap.append(el('legend', null, 'Settings'));
    const row = (label, input) => {
      const l = el('label', 'setting-row');
      const sp = el('span', null, label);
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
        const o = el('option', null, name); o.value = v; sel.append(o);
      }
      sel.value = s[key];
      sel.addEventListener('change', () => { s[key] = sel.value; this.applySettings(); cb?.(); });
      row(label, sel);
    };
    slider('Music volume', 'volMusic');
    slider('Effects volume', 'volEffects');
    slider('Ambience volume', 'volAmbience');
    slider('Voice volume', 'volVoice');
    toggle('Mute all', 'muted');
    select('Graphics tier', 'tier', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
    select('Theme', 'theme', THEMES.map((t) => [t.id, t.name]), () => this.syncBoard());
    select('Color-vision palette', 'cvd', [['none', 'Default'], ['deuter', 'Deuteranopia-safe'], ['protan', 'Protanopia-safe'], ['tritan', 'Tritanopia-safe']], () => this.syncBoard());
    toggle('Reduced motion', 'reducedMotion');
    toggle('High contrast', 'highContrast');
    toggle('Larger text', 'largeText');
    toggle('Left-handed controls', 'leftHanded');
    toggle('Hold to drag (vs tap)', 'holdToDrag');
    toggle('Haptics', 'haptics');
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
          this.announce(`Web complete! ${e.state.foundations} of ${e.state.webGoal}.`);
        } else if (ev.type === 'invalid') {
          this.audio.event('invalid');
          this.announce(`Not legal: ${reasonText(ev.reason)}.`);
          this.toast(`Not legal: ${reasonText(ev.reason)}.`, 2500);
        } else if (ev.type === 'win') this.audio.event('win');
        else if (ev.type === 'lose') this.audio.event('lose');
        this.renderer?.eventFx(ev);
        break;
      }
      case 'invalid': {
        this.audio.event('invalid');
        this.toast(`Not legal: ${reasonText(e.reason)}.`, 2500);
        this.announce(`Not legal: ${reasonText(e.reason)}.`);
        break;
      }
      case 'select': this.syncBoard(); break;
      case 'lesson-step': {
        if (e.step) { this.toast(e.step.text, 6000); this.announce(e.step.text); }
        else this.toast('Lesson complete when the web clears!', 3000);
        break;
      }
      case 'lesson-blocked': this.toast(e.message, 3000); this.announce(e.message); break;
      case 'while-away': this.toast(e.summary, 6000); this.announce(e.summary); break;
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
    if (newly.length) this.platform.reportAchievements?.(newly);
    if (def.ranked && st.status !== 'aborted') this.platform.submitScore?.(def, this.session.replayEnvelope());

    const headline = won ? '🕸 All webs cleared!' : st.status === 'aborted' ? 'Round abandoned' : 'The weave holds…';
    this.modal(headline, (body, close) => {
      const s = st.score;
      const table = el('dl', 'score-breakdown');
      const rows = [
        ['Base', s.base], ['Moves', s.movePenalty], ['Webs', `+${s.runs}`],
        ['Time bonus', `+${s.time}`], ['No-undo bonus', `+${s.noUndo}`], ['Total', s.total],
      ];
      for (const [k, v] of rows) { table.append(el('dt', null, k), el('dd', null, String(v))); }
      body.append(table);
      body.append(el('p', 'dim', `${st.moves} moves · ${st.invalid} invalid · ${Math.floor(st.elapsedMs / 60000)}:${String(Math.floor(st.elapsedMs / 1000) % 60).padStart(2, '0')} · ${st.terminalReason || ''}`));
      if (newly.length) {
        const ach = el('div', 'achievements');
        for (const k of newly) {
          const a = ACHIEVEMENTS.find((x) => x.key === k);
          ach.append(el('p', 'achievement', `🏅 ${a?.name || k} — ${a?.desc || ''}`));
        }
        body.append(ach);
        this.announce(`Achievement unlocked: ${newly.join(', ')}`);
      }
      const next = this.nextRecommended();
      body.append(
        this.button('Retry', () => { close(); this.startRound(def); }, 'btn btn-primary'),
        this.button(next.label, () => { close(); next.fn(); }),
        this.button('Title', () => { close(); this.show('title'); }),
      );
      this.announce(`${headline} Final score ${s.total}.`);
    });
  }

  nextRecommended() {
    const def = this.session.def;
    if (def.mode === 'journey') {
      const idx = JOURNEY.findIndex((j) => j.id === def.id);
      if (idx >= 0 && idx + 1 < JOURNEY.length) {
        return { label: 'Next stage', fn: () => this.startRound(JOURNEY[idx + 1]) };
      }
    }
    if (def.mode === 'learn') {
      const idx = LESSONS.findIndex((l) => l.id === def.id);
      if (idx >= 0 && idx + 1 < LESSONS.length) {
        return { label: 'Next lesson', fn: () => this.startRound(LESSONS[idx + 1]) };
      }
    }
    return { label: 'Journey', fn: () => this.show('journey') };
  }
}

function posStyle(r) {
  return { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' };
}

export function reasonText(reason) {
  return {
    'same-column': 'that is the same column',
    'face-down': 'that card is face-down',
    'broken-run': 'only same-thread descending runs travel together',
    'rank-mismatch': 'a run rests only on the next rank up',
    'empty-column': 'you cannot deal while a column is empty',
    'round-over': 'the round is over',
    'out-of-bounds': 'off the table',
  }[reason] || reason;
}
