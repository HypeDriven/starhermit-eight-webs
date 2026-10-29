# Eight Webs — Game Design Document (running spec)

Present-tense description of the shipped game. Every statement below is true of the code in this repository unless it sits in the final "Design intent not yet implemented" list.

## 1. Overview

**Pitch.** A two-deck patience game reframed as silk-weaving: build descending same-thread runs across ten columns of a shadow-box table, lift every complete King-to-Ace run off as a finished "web", and clear all eight before the stock and your options run out.

| | |
|---|---|
| Genre | Single-player card sequencing puzzle (Spider-family patience with authored progression) |
| Players | 1; local scores, history and a per-device daily board |
| Session length | Learn lesson 1–2 min; Journey/Practice/Daily round 10–40 min; Challenges 10–25 min |
| Platforms | StarHermit engine script game (engine 1.24.0, host API 1.21): natively in the StarHermit client and in desktop and mobile browsers through the engine's web runtime |
| Rendering | `starhermit:scene` orthographic "shadow-box" table under the card layer drawn with `starhermit:ui` (cards, stock, webs and pads are accessible widgets), both from one layout model |
| Entry | `native/main.ts` (`engine.entry`); browsers open the engine's loader `index.html` (`launch`); platform script `score-script.js` (`server=`) |

### File map

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: name, description, owner, `server=score-script.js`, cover, `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.24.0`, `engine.minor=19`, capabilities `platform,storage,clipboard`, `control.*` and `engine.gamepad.*` for every action |
| `native/main.ts` | Entry: the round controller (screens and dialogs state, round lifecycle with the saved round, selection, card cursor, drags, Deal/Undo/Hint, the clock, event presentation, progression, achievements, history, score posting, lifecycle), all on the runtime's fixed steps |
| `native/screens.ts` | Every screen, the HUD, the card layer, dialogs, toasts and captions on `starhermit:ui`; symbols and emoji (▶ ✓ ★ 🕸 🏅 ⏱ ♪ ☰ and the thread glyphs ●◆▲■) are plain text, drawn by the engine's fonts and built-in emoji |
| `native/render.ts` | The 3D table (`starhermit:scene`): felt, frame, inlay, corner webs, motes, sparks, lights, post chain per look |
| `native/quality.ts` | The browser build's presets and budgets keyed by the runtime's quality tier and level |
| `native/audio.ts` | Clips, room tone, music bed and rendered plucks on the runtime's buses; captions |
| `native/platform.ts` | Save (progress document), cloud-save migration and merge, device storage, game options and their migration, player, invite link, platform clock, score posting |
| `native/style.ts`, `native/i18n.ts` | Style sheet + per-theme tokens; locale from the runtime's interface language |
| `js/rules.js`, `js/content.js`, `js/session.js` | The browser build's pure rules, content and session (unchanged in what they decide; the session's clock is injectable) |
| `js/layout.js` | `computeLayout`, the table layout shared by the card layer and the 3D table |
| `js/progress.js` | Pure save helpers: the progress document, the old cloud save reader, option checks, the browser build's settings keys |
| `js/i18n.js`, `js/locales/*.js` | Localization core and the en-GB, es (es-419 + es-ES), de, fr (fr-FR + fr-CA), pt-BR and it-IT dictionaries keyed by the US-English text |
| `assets/ui-style.json` | `tools/ui-style.css` converted with `starhermit css` (`npm run css`) |
| `assets/textures/*.png` | Baked felt fibres and wood grain per theme (`npm run textures`) |
| `assets/*.webp`, `sfx/*.opus` | Key art, results art; 17 authored clips plus `music-gameplay.opus` (the old mp3 bed re-encoded) |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (never edited) |
| `score-script.js` | Platform script: range-checks a finished ranked round's total and posts it to the `high-score` board |
| `server.js` | Local dev server (static files, `/api/v1/time`, legacy routes); not packaged |
| `tests/` | `run-tests.mjs` (rules, content, session, layout, clock), `progress.test.mjs`, `i18n.test.mjs`, `native.mjs` + `native/*.play` |
| `tools/` | `css.mjs`, `package-web.mjs`, `bake-textures.mjs`, `gen-plays.mjs`, `browser-play.mjs` |

## 2. Vision and design pillars

1. **The table is the hero.** Everything on screen serves the ten columns: rails collapse before cards shrink, the felt bed and frame are the only environment, effects are small bursts at the column that changed. Rules out: HUD chrome over the columns, camera moves, decorative props that compete with card faces.
2. **Threads, not suits.** Runs are silk threads; only a same-thread descending run travels, and a complete King-to-Ace thread becomes a web. Colour and glyph always reinforce each other (●◆▲■), with colour-vision palettes swapping colour but never shape. Rules out: any mechanic that lets mixed-thread stacks move as a unit, or that hides rank/thread behind colour alone.
3. **Honest randomness, authored difficulty.** Every deal is a seeded shuffle (`buildDeck`), every stage has a fixed seed, dailies are one immutable seed per UTC day. Difficulty comes from thread count, hints/undo restrictions, move budgets and clocks — never from hidden stat changes. Rules out: rerolling a losing deal behind the player's back, pay-to-win assists, unsolvable authored lessons.
4. **Every action is replayable.** The only way state changes is `applyCommand`; invalid attempts are recorded, undo is a command, and a session's envelope replays server-side to the same hash before a score counts. Rules out: UI-only state that affects score, client-trusted totals.
5. **Teach by doing, one rule at a time.** Five lessons each isolate one rule and end in a real win; Journey introduces each new constraint alone before combining it. Rules out: wall-of-text tutorials, lessons that can be failed, mechanics that appear first in a ranked mode.

## 3. Player experience

**Target player.** Patience/solitaire players who want a calm table with authored progression and a fair competitive layer, on a phone or a desktop, in sessions that can be paused and resumed.

**First 60 seconds** (product QA bar: instructions or guided hints on first contact).
1. Title screen: key art of the shadow-box table, tagline "Weave descending runs of silk thread. Clear all eight webs.", big **Play**, and one-tap **Daily Challenge / Journey / Learn / Scores / Help**. Journey progress and lifetime webs cleared are shown under the buttons.
2. **Play → Choose a mode**: six labelled cards (Learn, Journey, Daily, Practice, Challenge, Scores), each with a one-line description. Every mode's setup card states thread count, clock, move budget, assists and ranked/unrated before the player commits.
3. **Learn → Build Down**: a three-column layout appears with a toast and screen-reader announcement: "Cards stack downward: a card rests on the next rank up. Move the 2 onto the 3 at the foot of the long run." Any other move is refused with "Follow the lesson: …" (`Session.lessonGate`). Two moves later the King-to-Ace thread lifts off, the results modal shows the score breakdown, and **Next lesson** is offered.
4. Any non-lesson round opens with a 3-2-1 countdown (700 ms per beat, skipped under reduced motion) and then announces "Round started. Clear 8 webs. 0/8 done."; **Help** (also inside Pause) lists the six rules in plain language.

**Session shape.** Pick a mode → read the setup card → 3-2-1 → lift/drop runs, deal when stuck, hint/undo where allowed → results modal (score table, achievements, Retry / Next / Title) → the next stage or the title. Leaving mid-round autosaves; the title shows **Resume saved round**.

**Emotional beat.** The lift-off: a thirteen-card thread completing, the column shortening with a burst of accent particles, the three-bell chime and "Web complete! n of 8." The round is built around earning that moment eight times while the stock shrinks.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; the session (`js/session.js`) only decides which command to send.

### Deck, layout, threads
- 104 cards; `buildDeck(seed, suits)` builds `8 / suits` copies of ranks 1–13 for each of `suits ∈ {1, 2, 4}` threads and shuffles with `createStream("deck:" + seed)` (mulberry32 seeded by FNV-1a of the string).
- `dealLayout`: columns 0–3 receive 6 cards, columns 4–9 receive 5, only each column's last card face-up (54 cards, 44 hidden); the remaining 50 cards become five face-up stock packets of ten.
- Authored layouts (`def.layout`) bypass the deal: lessons use them, padding to ten columns with inert single Kings.

### Legal actions (`checkMove`, `canDeal`)
- **Move** `{from, idx, to}`: cards `from[idx..]` must all be face-up, same thread, descending by exactly one (`isMovableRun`); destination must be empty or have a top card of rank `moving.r + 1` in **any** thread. Reasons for illegality: `same-column`, `face-down`, `broken-run`, `rank-mismatch`, `out-of-bounds`, `round-over`.
- **Deal**: legal only while the stock is non-empty and **no column is empty**; one card from the next packet lands face-up on every column in order.
- **giveUp**: ends the round as `aborted / gave-up`.
- **note**: heartbeat carrying only a timestamp (the UI sends one when a clock expires between inputs).
- Tapping inside a mixed stack lifts the longest movable run beneath the tap (`Session.movableStart`).

### Resolution order inside `applyCommand`
1. Command id must equal `state.nextCmdId` (duplicates → `duplicate-command`, gaps → `out-of-order-command`); state is cloned, `tick` and `elapsedMs = max(elapsedMs, cmd.at)` advance.
2. If a time limit exists and `elapsedMs > limits.timeMs`, the round ends `lost / time-limit` before the command body.
3. **Move**: an in-bounds but illegal move is not rejected — it increments `invalid` and emits an `invalid` event (it stays in the replay log). A legal move splices the run, increments `moves`, emits `move`, flips the newly exposed card in the source column (`flipExposed`, emits `flip`), then `collectRuns` on the destination.
4. **Deal** with an empty column is likewise recorded as `invalid: empty-column`; a legal deal emits `deal {remaining}` and runs `collectRuns` on all ten columns.
5. `collectRuns`: while the top 13 cards of a column are face-up, same-thread and K→A, splice them off, `foundations += 1`, emit `run-complete`, flip the card exposed beneath.
6. `checkTerminal`: `foundations >= webGoal` → **won** (`all-runs`); `moves >= limits.moves` → **lost** (`move-limit`); empty stock with no legal moves and cards still on the table → **lost** (`no-moves`). Otherwise the total is recomputed.

### Scoring (`SCORE`, `recomputeTotal`, `finish`)
`total = max(0, 500 − moves + 100 × webs + timeBonus + noUndoBonus)`
- `timeBonus` (win only, only when `par.timeMs` exists and `elapsedMs < par.timeMs`) = `floor((par.timeMs − elapsedMs) / 1000) × 2`.
- `noUndoBonus` = 50 on a win with `undos === 0`.
- Invalid actions never change the score; they are a tie-break.

Worked examples:
- Lesson 1 win in 2 moves, no par, no undo: `500 − 2 + 100 + 0 + 50 = 648` (exactly what the results modal shows).
- Practice "Single Thread" won in 180 moves at 10:00 with par 25:00 and no undo: `500 − 180 + 800 + (1500 − 600) × 2 + 50 = 2970`.
- Journey stage abandoned after 11 moves: `500 − 11 = 489`, no bonuses.

### Terminal states
`status ∈ {active, won, lost, aborted}` with `terminalReason ∈ {all-runs, move-limit, time-limit, no-moves, gave-up}`. Commands after the end return `round-over`. The UI headline is "🕸 All webs cleared!", "Round abandoned", or "The weave holds…".

### Tie-break (`compareResults`, used by `server.js`'s legacy leaderboard)
won > lost > aborted; then more webs; then higher total; then fewer invalid actions; then lower `elapsedMs`; then session id.

### Undo and hints
- `Session.undo` (only when `def.assists.undo`, during an active round, stack ≤ 200 snapshots) restores the previous serialized state, increments `undos`, and appends a replayable `{type:'undo', toId}` marker; `rules.replay` honours these markers so ranked envelopes still validate. Invalid attempts and lesson-gated moves do not push undo snapshots.
- `getHint` uses the same `listLegalMoves`, scored: completes a web +1000, flips a hidden card +120, same-thread build +60, non-empty destination +10, moving a whole column into an empty one −50; ties broken by from/to/idx. The UI dashes the run for 3.5 s.

### Determinism, serialization, replay
`hashState` covers version, suits, tick, status, counters, elapsed, total and every card; `serialize/deserialize` round-trip with a `MIGRATIONS` table keyed by `v` (currently only `RULES_VERSION = 1`). `replay(envelope)` recreates the game from `init`, applies every command and undo marker, and returns per-checkpoint hashes. Property tests confirm identical (version, seed, commands) → identical hashes across 20 seeds.

## 5. Modes and progression

| Mode | Content | Threads | Assists | Ranked | Notes |
|---|---|---|---|---|---|
| Learn | 5 authored lessons (`LESSONS`), `webGoal = 1` | 1 | hints + undo | no | Steps gated by `lessonGate`; validators prove each lesson wins |
| Journey | 40 stages (`JOURNEY`), seeds `journey-n` | 1→2→4 | per stage | mastery stages only | Stage n+1 unlocks when stage n is won (`progress.journey`) |
| Daily | `dailyForDate(today UTC)` | 1 (50 %), 2 (35 %), 4 (15 %) | undo only | yes | 35 % of days carry a 15–25 min clock; theme rolled from the stream |
| Practice | Single Thread / Twin Threads / Full Loom, seed `practice-<timestamp>` or custom text | 1 / 2 / 4 | hints + undo | no | Custom seed input always uses Single Thread |
| Challenge | Silk Sprint (10 min clock), Move Diet (≤200 moves), Twin Trial (2 threads, no undo), Grand Loom (4 threads, no hints/undo) | 1 / 1 / 2 / 4 | varies | yes | Fixed seeds `challenge-*` |

**Journey curve** (`JOURNEY_SCRIPT`): five webs of eight stages, each web themed (Shadow Box, Midnight Silk, Jade Loom, Porcelain Case, Ember Thread) and ending in a ranked "Mastery" stage. Web 1 teaches the table on one thread, then removes hints and adds a generous clock; Web 2 adds clocks (20→15 min) and move budgets (260→240) and removes undo; Web 3 introduces the second thread and re-applies each constraint alone before combining; Web 4 removes tools (no hints, no undo) with tighter budgets; Web 5 is four threads with a long clock, then budget, then no net. Par: 160 / 220 / 320 moves for 1 / 2 / 4 threads; par time is 80 % of the clock or 15 min.

**Unlocks and records.** `progress` (the game's save, §12) tracks journey wins with score and time, lessons done, mastery, achievements, lifetime webs, distinct days played, and per-content bests. The last 50 results are kept in the device's history; Scores shows the last 10.

**Achievements** (`ACHIEVEMENTS`, granted in `UI.onRoundEnd`, idempotent): First Web, Full Toolkit (won a round after dealing, using an empty column and clearing a web), Five-Day Weave (webs cleared on five distinct days), Mastery Bound, Century of Silk (100 webs). New unlocks appear in the results dialog with a 🏅 and a chime 0.7 s after the sting; they are kept in the save (not platform achievements).

## 6. Controls and interaction

Actions (`starhermit.txt`; players rebind keys and pads in the runtime's Options, and Settings › **Change keys and buttons** opens the rebind screen):

| Action | Keys | Gamepad | Pointer / touch |
|---|---|---|---|
| `left`/`right`/`up`/`down` (card cursor) | Arrows | D-pad, left stick | — |
| `confirm` (lift / drop at the cursor) | Enter, Space | A (South) | Tap or click a face-up card to lift its run, then a card or empty pad of the destination |
| `deal` | D | X (West) | **Deal** in the tray, or a stock packet |
| `hint` | H | Y (North) | **Hint** |
| `undo` | U | LB | **Undo** |
| `pause` (set the lifted run down, else pause) | Escape | B (East), Start | ☰ in the top bar |

| Input | Feedback |
|---|---|
| Lift | The run rises 4 px with a 3 px select-colour outline and a deeper shadow, legal destination columns get a legal-colour frame and tint, `select` clip, 8 ms haptic |
| Drop | `move` clip and a small burst at the column; `flip` when a card turns; otherwise `invalid` and the toast "Not legal: …" |
| Drag | Press a face-up card and move > 12 px: its run lifts; release over a column drops it there, over its own column sets it down (`deselect`), over no column keeps it lifted. A drag's release never counts as a tap |
| Hint | Dashed accent outline on the hinted run for 3.5 s, `hint` clip, spoken announcement |
| Keyboard cursor | A 3 px outline on the focused card; arrows walk the columns (skipping empty ones, except while a run is lifted, so a run can be dropped on an empty column by keys) and the cards within a column; each step is announced |

Input locking: cards, stock and pads take presses only while `Session.inRound()` and no dialog or countdown is up; face-down cards are disabled widgets; **Deal** is disabled when the stock is empty (tooltip "The stock is empty"); **Undo/Hint** are disabled when the content's `assists` forbid them; lesson steps refuse any other action. Board presses act after the board is built from the frame's state. **Hold to drag (vs tap)**: when on, pointer and touch taps on cards do not lift runs (lift by dragging; Enter still lifts at the cursor). Arrow keys and Enter go to the card cursor unless a widget has focus (Tab reaches the tray and top bar).

## 7. Screens and UI flow

**Machine (`Session.MACHINE_STATES`)**: `boot → title → … → countdown → active ⇄ paused → resolving → results`; `tutorial` replaces `countdown/active` for lessons; `reconnecting` is entered by restoring a snapshot (as `paused/reconnect`).

**Screens (`show` in native/main.ts)**: `title`, `modes`, `journey`, `lessons`, `challenges`, `practice`, `help`, `scores`, `play`. List screens scroll with **← Back** pinned at the bottom; Escape backs out (lists → modes → title). The title row ends with **Settings**, a dialog over the title (the settings section plus Close). Dialogs (each focuses its first control; a scrolling body with the buttons pinned below): Paused (the restored-round note, the settings section; Resume, Help, Restart round, Give up, Leave to title; Escape resumes) and Results (art, score table, stats line, leaderboard line, achievements; Retry, Next stage/lesson or Journey, Title — in one row on short windows). Help opened from the pause dialog returns to it. Overlays: 3-2-1 countdown (dimmed window), toasts (2.5–6 s, up to three stacked above the bottom 12 %), the caption strip 64 px above the bottom.

**Layout.**
- ≥ 1024 px wide: three-column grid — Objective rail (150–220 px: goal, hidden count, deals left, score formula, moves/invalid), playfield, Status rail; top bar (☰, title, clock) and bottom tray (Undo, Hint, Deal).
- < 1024 px (portrait or landscape): rails hidden; portrait gives the playfield ≥ 55 dvh.
- Landscape ≤ 500 px tall: top bar 40 px and tray 48 px; title/results art hidden so controls stay on screen.
- Safe areas: the UI lays out inside the runtime's safe area; the margins outside it take the panel colour.
- The board layout (`computeLayout`) fits ten columns to the playfield width and compresses card overlap so the longest column always fits the height; nothing on the table scrolls or clips. Menus scroll vertically (`justify-content: safe center`) so the Back button is always reachable.
- Sizes are logical pixels times `ui.preferences().scale` (the window's scale and the player's interface size); the runtime's interface and text size options enlarge everything, and the breakpoints follow the logical size. Card ranks are max(12, 1.4 % of the width) px, thread shapes max(14, 2.4 %).

## 8. Art direction

**Fantasy.** A collector's shadow box: recessed felt, a beveled frame, silk threads pulled taut across the corners, ivory cards with bold rank marks. Warm, quiet, slightly antique.

**Palette (`THEMES` in `js/content.js`; the active theme is a setting applied as CSS variables).**

| Theme | paper | ink | panel | felt | accent | select | legal |
|---|---|---|---|---|---|---|---|
| Shadow Box (default) | `#efe7d8` | `#2e2a24` | `#faf5ea` | `#5d4a38` | `#b0622a` | `#2f80ed` | `#3f9d63` |
| Midnight Silk | `#1d2233` | `#e6e2d6` | `#262c42` | `#232a44` | `#e0a458` | `#7aa5f8` | `#6fcf97` |
| Jade Loom | `#e6f0ea` | `#1e322a` | `#f4fbf7` | `#274d40` | `#c96f2e` | `#2f80ed` | `#3f9d63` |
| Porcelain Case | `#eef1f6` | `#252b3a` | `#fafbfd` | `#8b9bb8` | `#5b5fc7` | `#2f80ed` | `#3f9d63` |
| Ember Thread | `#f3e6e0` | `#3a2320` | `#fdf3ee` | `#5a3230` | `#b03a2e` | `#7a4de8` | `#3f9d63` |

Danger is `#c0392b` (`#eb5757` on Midnight). Threads: Crimson `#c0392b` ●, Amber `#c97b12` ◆, Jade `#1f8a70` ▲, Indigo `#3457c9` ■; CVD palettes (deuter/protan/tritan) replace the four colours with Okabe-Ito-style sets while glyphs stay.

**Shape and type.** 8–14 px radii on cards, pads and dialogs; 1.5 px card borders (2.5 px under the runtime's high contrast); the system sans throughout. Cards are drawn by the UI exactly as the browser build's DOM cards were: an ivory face (`#fdfaf2`) with the rank top-left and the thread's glyph centred in the thread colour, a felt-coloured back, a striped felt stock with its "DEAL" label on the top packet (beside the pile when it does not fit), accent webs for cleared runs, dashed pads for empty columns. On the detailed looks the faces get a paper sheen and two-layer shadow, the backs a faint spoked web with rings (a canvas texture painted once per felt colour), the webs a highlight.

**Motion.** A lifted run rises 4 px (not under reduced motion); bursts are quads with a 500 ms life (700 ms glowing additive sparks on the high particle looks), capped per look; motes drift and glint; the countdown runs 700 ms a beat. Under the runtime's **Reduced motion** the countdown is skipped, the lift does not move, motes freeze and no sparks fly.

**Graphics.** The table is lit by a warm key directional light from the upper left (2.0/π in the engine's convention), a hemisphere fill (1.1/π) and an ambient term (0.25/π), with ACES filmic tone mapping. The felt is the baked fibre texture (colour and bump), the frame rails show their wood-grain lip inside the playfield edge and throw a thin shadow, a brass inlay runs along it and faint silk webs fill the two lower corners. The runtime's Options › Graphics choose the level (Auto from the device, render scale, frame-rate limit and readout, adaptive resolution); `native/quality.ts` maps its tier and level to the browser build's presets:

| Look (tier) | Shadows | AO | Bloom / grade | AA | Reflections | Particles | Motes | Detail | Materials |
|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | off | off | small squares | still | plain | Lambert |
| Balanced | 1024 | off | on | FXAA | on | glowing | animated | detailed | Standard |
| High | 2048 | on | on | SMAA | on | glowing | animated | detailed | Physical frame (clear coat) |
| Ultra | 4096 | high | on | MSAA | on | glowing | animated | detailed | Physical frame |

Sparks (40 / 90 / 240 / 400) and motes (16 / 32 / 64 / 96) grow with the level within a tier (×1.64 a level, ≤ 4×, capped at 120 sparks on Low and 600 / 256 overall). Reflections are a PMREM-filtered `RoomEnvironment(renderer)` per material (felt 0.12, frame 0.45, inlay 1.0); bloom threshold 0.9; the grade is the old GradeShader in display space (slight S-curve, saturation 1.08, warm highlights / cool shadows, 0.28 vignette). Gameplay is identical on every look.

**Hero.** The table. Key art appears only on the title (`assets/key-art.webp`) and the results modal (`results-win.webp` for a win, `results-over.webp` for a loss/abandon); both are decorative, drawn cover-fitted with the felt colour behind them; they are hidden on windows ≤ 500 px tall.

**Visual assets the design calls for**: title key art, two results illustrations, store cover, icon/favicon — all shipped (see §15). No 3D model is required: the table, cards and markers are procedural geometry.

## 9. Audio direction

**Mix.** The runtime's buses (Options › Audio owns volumes, mute and the voice limit): music → `music`; effects and the ambience → `effects`. The old default bus levels (music 0.6, effects 0.8, ambience 0.4) are folded into each sound's gain. Audio starts with the first press in a browser (natively at once); clips load one at a time once the mixer runs, and a clip still loading is silent (the synthesized stand-ins are not ported). A hidden window stops the loops. Every cue also shows a caption ("♪ web complete!") for 1.6 s so nothing is audio-only.

**Ambience.** `sfx/ambience-study.opus` (12 s study room tone) loops at 0.6 gain from the first press.

**Music.** `sfx/music-gameplay.opus` (the old `music_gameplay.mp3` bed, re-encoded) loops at 0.35 gain under triangle-wave plucks on a C-major pentatonic set (C4 D4 E4 G4 A4 C5, octave jump 20 %), rendered once into clips; pluck probability and loudness rise with `webs / webGoal`, the beat shrinking from 1400 ms to 800 ms.

**Effects hierarchy.** input acknowledgement < legal move < flip/deal < web complete < round end; clips are loudness-normalised to −20 LUFS.

### SFX event table (source of `sfx/manifest.txt`)

| Event id | File | Sound | Usage |
|---|---|---|---|
| `select` | `card-select.opus` | Card tapped on felt, crisp papery snap | Run lifted; every menu button |
| `deselect` | `card-deselect.opus` | Card laid back on a stack, soft slide | Escape / re-tap / drop on origin |
| `move` | `card-move.opus` | Card slides across wood, soft landing | Rules `move` event |
| `invalid` | `invalid-move.opus` | Wooden knock + muted card slap | Rules/session `invalid` |
| `flip` | `card-flip.opus` | Quick snappy paper flick | Rules `flip` event |
| `deal` | `deal-row.opus` | Row dealt rapidly across felt | Rules `deal` event |
| `run-complete` | `web-complete.opus` | Ascending three-note brass bells | Rules `run-complete` |
| `hint` | `hint-chime.opus` | Soft glass-bell chime | Hint shown |
| `undo` | `undo-whoosh.opus` | Reversed airy whoosh | Undo applied |
| `win` | `round-win.opus` | Bells + rising harp fanfare | Rules `win` |
| `lose` | `round-lose.opus` | Descending muted marimba | Rules `lose` |
| `tick` | `clock-tick.opus` | Dry mechanical clock tick | Each countdown beat |
| `time-warning` | `clock-warning.opus` | Urgent brass double tick with bell overtone | Clock first drops under 60 s (one-shot per round) |
| `achievement` | `achievement-unlock.opus` | Rising glockenspiel arpeggio with shimmer | Results modal lists a new achievement (0.7 s after the sting) |
| `lesson-step` | `lesson-step.opus` | Two-note wooden xylophone tap | Lesson advances to its next instruction |
| `pause` | `pause-open.opus` | Felt-lined drawer sliding open | Pause modal opens |
| `ambience` | `ambience-study.opus` | Study room tone: clock, distant birds, warm hum | 12 s loop on the effects bus |

## 10. Localization

All player-facing text ships in the nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT. Strings are authored in US English and looked up by that text (`T('Deal')`, `{name}` placeholders) in `js/i18n.js`; `js/locales/` holds the dictionaries (en-GB lists only spelling differences, es-ES and fr-CA only their differences from es-419 and fr-FR). Content (`js/content.js` thread, theme, stage, lesson, practice, challenge and achievement texts), rule-violation reasons, terminal reasons and audio captions keep their English keys and are translated at display time, so progress, history and round snapshots stay language-neutral. Card ranks keep their A/J/Q/K glyphs in every locale. Strings the runtime's own Options show (volumes, graphics, language, accessibility) are the runtime's.

**Language source.** The runtime's interface language (`preferences().language`: the player's choice in Options › Language, else the account's preferred language, else the device's), mapped to the nearest shipped locale (en-GB, es-ES and fr-CA by region). A change applies on the next frame everywhere — screens, dialogs, the HUD and card labels are rebuilt every frame — while the round, its clock and the pause state are untouched.

Layout: buttons are content-sized with 44 px minimums, button rows wrap, labels too wide for their room become paragraphs, the round's title truncates with an ellipsis, and the stock's label moves beside the pile when the word is wider than the packet.

## 11. Accessibility

- **Keyboard and gamepad path**: title (Play focused) → mode → Start, all widgets in the runtime's focus order with its focus ring; in the round the card cursor (arrows, Enter/Space) plus D/H/U/Escape cover every action, Tab reaches the tray and the top bar; dialogs focus their first control, the one that opened them does not close them in the same frame.
- **Screen reader**: every card is a button named "Column 3: 7 of Jade thread, run of 4"; pads ("Column 5 (empty)"), stock packets and cleared webs are named; announcements cover round start, cursor moves, hints, invalid reasons, web completion, achievements and results.
- **Captions**: every audio cue writes a caption strip.
- **Contrast, text size, motion**: the runtime's high contrast (card borders thicken to 2.5 px), text size and reduced motion apply; **Left-handed controls** reverses the tray.
- **Colour vision**: Settings › Color-vision palette (three CVD palettes); thread shapes are always present.
- **Targets**: buttons ≥ 44×44; cards are full-size buttons; **Haptics** (vibrate) can be switched off.

## 12. StarHermit integration

| Feature | Status | Where |
|---|---|---|
| Manifest | `name`, `description`, `owner`, `server`, `cover`, `launch`, `engine.*`, one `control.<action>` and `engine.gamepad.<action>` line per action, group names for the runtime's controls screen | `starhermit.txt` |
| Player | `player()` (signed in or a guest); the title shows "Playing as <name> · progress synced / saving… / cloud sync unavailable", **Sign in with StarHermit** for guests (`requestSignIn`) and **Invite a friend** when signed in (copies the fetched `inviteLink()`, toast; shows the link if the clipboard is refused) | `native/platform.ts`, `screens.ts` |
| Save | The progress document is the game's save (`saves`, schema 1) on the device and in the cloud slot; on a conflict both copies merge with `mergeProgress` (higher journey score per stage, union of lessons, mastery and play days, earliest achievement, max bests and webs); when another device's save arrives it is merged in (toast "progress synced") | `native/platform.ts`, `js/session.js` |
| Browser build's cloud save | Shown as foreign (the JS SDK's `saveJSON` text of the same document, key `game:<slug>`): parsed (`js/progress.js readForeign`), merged with this device's progress and saved over it once with `replaceForeign` | `migrateForeign` |
| Device data | The round history (last 50) and the saved round (`eightwebs:autosave`: def, serialized state, commands; written after every action, on pause, when hidden and on leaving; cleared at round end) are `storage` on the device. A guest's old browser localStorage cannot migrate | `platform.local` |
| Settings | The game's options (theme, colour-vision palette, left-handed, hold to drag, haptics) are `settings` (`game.<key>`, synced with the account). The browser build's account settings are migrated once: those five keys adopted unless set since, then every old key (volumes, mute, graphics, reduced motion, high contrast, larger text, camera preset, `ui.language`, `audio.options`, `graphics.gpu.*`) removed | `importLegacy` |
| Platform clock | `serverNow()` (after `serverTime()`), else the device clock: the daily's UTC date, the Scores screen's day, the replay envelope's offset | `nowMs`, `todayUTC` |
| Leaderboard | Signed in, every ranked round (Daily, Challenges, Journey mastery stages) that ends won or lost — not given up — posts its total through `score-script.js` (a practice session whose socket carries `{ type: 'result', scores: { 'high-score': total } }`; the script range-checks 0–20,000 and posts it). The results show "Posting score to the leaderboard…", then "Leaderboard rank: #N" from the board's entries (or posted / not posted). Solo scores stay range-checked by the script (no server-side replay validation) | `postLeaderboard` |
| In-game boards | The Scores screen lists the last 10 results and today's daily wins on this device | `scoresScreen` |
| Achievements | In the save only (no platform achievements) | `onRoundEnd` |
| Options, reports | Sound, graphics, frame rate, language, accessibility, controls and problem reports are the runtime's Options (Settings › **Open Options**, F1) | — |
| Multiplayer, telemetry | None | — |

## 13. Technical architecture

- **Layering**: `js/rules.js` (pure) ← `js/content.js` ← `js/session.js` ← `native/main.ts` (controller) → `screens.ts` (UI), `render.ts` (table), `audio.ts`, `platform.ts`. Rules never import engine modules; the table and sound consume snapshots and events only.
- **Frame**: `onFixedUpdate` (60 Hz) advances the session clock, the countdown, the hint timer, the one-minute warning and the authoritative time-out (a `note` command when a clock runs out), and the sparks; `onUpdate` picks the look from `frame().quality`/`levelIndex`, pumps audio and expires toasts; `onRender` builds the UI (screens, card layer, dialogs), then decides queued pointer presses (drags) against that frame's layout, then moves the motes.
- **Determinism**: the session clock is the fixed steps, so a play script replays exactly; three seeded streams — rules (`deck:<seed>`), decor (`decor:*`), audio (`audio:variants`).
- **Renderer**: an orthographic camera spans the window in logical pixels with the playfield's corner at the world origin (layout y negated), so the felt and frame sit exactly behind the card layer; the camera stands 2,000 units above the table (see Known limitations). Textures are baked PNGs; the card backs and stock stripes are canvas textures painted once per felt colour and used through registered styles.
- **Lifecycle**: a hidden window pauses the round (opening the pause dialog), saves the snapshot and flushes the save; quitting saves the snapshot.

## 14. Testing and acceptance criteria

**`npm test`** = `npm run test:unit` + `npm run test:native`.

- `tests/run-tests.mjs` (33): deck, layout, seeds, every illegality reason, runs, moves, flips, web collection, scoring, deals, command ids, invalid actions, move/time/no-moves/give-up terminals, hints, serialization, hashes, 20-seed replay property, fuzzing, undo replay, golden hashes, `compareResults`, content counts, daily immutability, offline validators; `computeLayout` fits ten columns and compresses long columns at desktop, phone and short landscape sizes; the session clock follows the injected clock (pause, time-limit loss).
- `tests/progress.test.mjs`: the progress document, the old cloud save read and merged, `mergeProgress`, option checks and the browser build's keys.
- `tests/i18n.test.mjs`: every `T`/`N` key in `native/*.ts` and `js/`, the captions and the content texts exist in all locales with the same placeholders; no stale keys.
- `tests/native.mjs`: the web index matches the files, `tsc` (strict, no `skipLibCheck`), `starhermit check .` with zero warnings, and every `tests/native/*.play` as a guest `--render-check`: `screens.play` (every menu screen, Practice with a typed custom seed, pause, leave, Resume saved round, Help from the pause dialog, Give up, Settings, Escape backing out), `learn-lessons.play` (all five lessons by keyboard to their results, chained by Next lesson, then the ticked Learn list), `journey-stage.play` (stage 1: twelve moves, Hint, a deal, Undo, pause, Give up, results), `challenge-move-diet.play` (Move Diet played to its 200-move budget and the results). The scripts are generated by `tools/gen-plays.mjs` from the rules and a model of the card cursor.
- **Browser check** (`npm run test:browser`, `tools/browser-play.mjs`; Chrome on the machine's GPU through `~/games/tools/gpu-chrome.mjs`): the packaged loader on loopback at 1366×768, 390×844 (DPR 3) and 844×390 (DPR 3) — Play, Learn, lesson 1 to its results by the keyboard on the desktop, by a drag and two taps on the phones — with no console errors or warnings; `~/games/tools/engine-web-smoke.mjs` passes at desktop and phone.

## 15. Asset inventory

| Path | Purpose | Source |
|---|---|---|
| `cover.jpg`, `coverart.png` (dev only), `icon.png` | Store cover, launcher icon | generated / authored |
| `assets/key-art.webp` | Title hero image | FLUX.2 klein, seed 3101 |
| `assets/results-win.webp`, `results-over.webp` | Results art | FLUX.2 klein, seeds 3102 / 3103 |
| `assets/textures/felt-<theme>.png`, `wood-<theme>-h.png`, `wood-<theme>-v.png` | Baked table surfaces | `tools/bake-textures.mjs` (the old procedural canvases) |
| `assets/ui-style.json` | Converted style sheet | `tools/css.mjs` |
| `sfx/*.opus` × 17, `sfx/manifest.*` | Event clips and the ambience loop (§9) | MOSS-SFX v2.0 |
| `sfx/music-gameplay.opus` | Music bed | the bundled `music_gameplay.mp3`, re-encoded with ffmpeg (Opus 64 kb/s) |

## 16. Known limitations

- Journey stages carry a `theme` per web, but the table always uses the player's Theme setting.
- The browser build's camera-preset setting is not ported (it had no effect); its Voice volume bus carried nothing.
- The client plays dailies locally; the dev server's authoritative daily-session routes are unused, and only today's daily board on this device is shown.
- Custom seeds in Practice always use Single Thread.
- The clock shows the time of the last move while paused (the session's existing behaviour).
- Drags are not covered by the native play scripts (they cannot drag); the browser check drags a card.
- Engine workarounds (found on 1.16.5): specular light under an orthographic camera follows the direction to the camera's position, so the camera stands 2,000 units up (100 units up put a highlight on the inlay; 20,000 units drew nothing); textures for `draw.box` go through registered styles (an inline style's `Texture` image is refused). The camera one is re-checked on 1.24.0 and still applies.
- The per-category graphics overrides, render scale and frame-rate controls of the old Graphics panel are the runtime's level choice and Options; the old volume and mute settings are not migrated into the runtime's.
- A guest's browser-localStorage progress, history and saved round cannot migrate; signed-in progress does (cloud save).

## 17. Design intent not yet implemented

- Apply each Journey web's theme on stage start (with the player's setting as an override).
- In-game browsing of the platform leaderboard (the Scores screen is still local; only the results rank line reads the platform board).
