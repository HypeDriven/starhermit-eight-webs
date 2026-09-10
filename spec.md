# Eight Webs — Game Design Document (running spec)

Present-tense description of the shipped game. Every statement below is true of the code in this repository unless it sits in the final "Design intent not yet implemented" list.

## 1. Overview

**Pitch.** A two-deck patience game reframed as silk-weaving: build descending same-thread runs across ten columns of a shadow-box table, lift every complete King-to-Ace run off as a finished "web", and clear all eight before the stock and your options run out.

| | |
|---|---|
| Genre | Single-player card sequencing puzzle (Spider-family patience with authored progression) |
| Players | 1; asynchronous competition through validated daily/global leaderboards when hosted |
| Session length | Learn lesson 1–2 min; Journey/Practice/Daily round 10–40 min; Challenges 10–25 min |
| Platforms | Desktop and mobile browsers (Chrome-class, ES modules, WebAudio, optional WebGL) |
| Rendering | Three.js orthographic "shadow-box" scene under a fully interactive DOM card layer that uses the same layout model; the DOM layer alone is a complete game when WebGL is unavailable |
| Entry | `index.html` (`launch` in `starhermit.txt`); optional authoritative `server.js` |

### File map

| Path | Responsibility |
|---|---|
| `index.html` | Shell markup, all CSS (theme variables, three breakpoints, overlays, settings), import map for `three` |
| `js/main.js` | Boot: platform time probe, AudioEngine/Session/TableRenderer/UI wiring, first-gesture audio start, `window.__eightwebs` debug handle |
| `js/rules.js` | Pure deterministic rules engine: deck, layout, legality, `applyCommand`, scoring, terminal states, hashing, replay, tie-break |
| `js/content.js` | Suits, five themes, `makeDef`, 5 lessons, 40 Journey stages, daily generator, practice difficulties, 4 challenges, 5 achievements, offline validators |
| `js/session.js` | Session controller: machine states, selection/tap semantics, undo snapshots, lesson gating, autosave, replay envelope |
| `js/ui.js` | DOM shell: screens, modals, board mirror, input (pointer/keyboard/gamepad), settings, progression, results |
| `js/render.js` | Three.js table: `computeLayout` (shared with UI), pooled card meshes, procedural card textures, markers, particles, quality tiers |
| `js/render-helpers.js` | Re-exports `createStream`/`rankLabel` so render never imports rules-only internals |
| `js/audio.js` | WebAudio buses, authored Opus clips with synthesized fallbacks, ambience loop, adaptive music, captions |
| `js/platform.js` | localStorage persistence, hosted REST adapter (`/api/v1/*`) gated by a time probe, score/achievement submission, telemetry stub |
| `server.js` | Dependency-free Node server: static files, `/api/v1/time`, daily descriptors, replay-validated score submission, leaderboards, achievements, plus a legacy `/api/session` and `/api/game/*` state API |
| `starhermit.txt` | Platform manifest (`name`, `launch`, `owner`, `server`, `cover`) |
| `starhermit_zh.txt` | Chinese-language server/network chapter that the legacy `/api/session` routes follow; the browser client does not call those routes |
| `tests/run-tests.mjs` | 31 offline rules/content/session tests (`npm test`) |
| `tests/e2e.mjs` | Playwright playthrough of the real UI at desktop and mobile viewports (`npm run test:e2e`) |
| `sfx/` | 17 Opus clips, `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md` (generated) |
| `assets/` | `key-art.webp`, `results-win.webp`, `results-over.webp`, `audio/*.mp3` bundled samples |
| `coverart.png`, `icon.png`, `favicon.svg` | Store cover (1200x675), launcher icon, tab icon |
| `vendor/three.module.js`, `vendor/three.core.js` | Three.js r185 |

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

### Tie-break (`compareResults`, used by the server leaderboard)
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

**Unlocks and records.** `progress` (localStorage) tracks journey wins with score and time, lessons done, mastery, achievements, lifetime webs, distinct days played, and per-content bests. The last 50 results are kept in history; Scores shows the last 10.

**Achievements** (`ACHIEVEMENTS`, granted in `UI.onRoundEnd`, idempotent): First Web, Full Toolkit (won a round after dealing, using an empty column and clearing a web), Five-Day Weave (webs cleared on five distinct days), Mastery Bound, Century of Silk (100 webs). New unlocks appear in the results modal with a chime and are POSTed to `/api/v1/achievements` when hosted.

## 6. Controls and interaction

| Input | Desktop | Mobile touch | Feedback |
|---|---|---|---|
| Lift a run | Click a face-up card | Tap | Run rises 4 px with a blue outline, legal columns glow green, `select` clip, 8 ms haptic |
| Drop | Click destination card or empty-column pad | Tap | `move` clip + small burst at the column; `flip` clip if a card turns; `invalid` clip + toast "Not legal: …" otherwise |
| Drag | Press, move > 12 px, release over a column | Same (pointer capture, `touch-action: none`) | Lift happens at the threshold; releasing on the origin sets it down quietly (`deselect`); releasing off-table keeps it lifted |
| Cancel | Escape, or tap the lifted run again | Tap the lifted run again | `deselect` clip |
| Deal | **Deal** button, `D`, or click a stock packet | Same | `deal` clip, green burst, toast if a column is empty |
| Hint | **Hint** button or `H` | Same | Dashed accent outline for 3.5 s, `hint` clip, spoken announcement |
| Undo | **Undo** button or `U` | Same | `undo` clip, "Move undone." |
| Pause | ☰ button, Escape (no selection), gamepad Start | ☰ | Pause modal with settings; `pause` clip |
| Keyboard board | Arrow keys move a focus cursor across columns/cards, Enter/Space lifts or drops | — | Focused card gets a 3 px outline; board has `role="application"` |
| Gamepad | D-pad = focus, A = confirm, B = cancel/pause, Start = pause | — | Same as keyboard |

Input locking: the board ignores taps unless `Session.inRound()` (active or tutorial machine state); face-down cards are disabled buttons; **Deal** is disabled when the stock is empty; **Undo/Hint** are disabled for content whose `assists` forbid them; lesson steps refuse any action other than the required one. Every menu button plays the `select` clip.

## 7. Screens and UI flow

**Machine (`Session.MACHINE_STATES`)**: `boot → title → … → countdown → active ⇄ paused → resolving → results`; `tutorial` replaces `countdown/active` for lessons; `reconnecting` is entered by restoring a snapshot (as `paused/reconnect`).

**Screens (`UI.show`)**: `title`, `modes`, `journey`, `lessons`, `challenges`, `practice`, `help`, `scores`, `play`. Modals: Paused (Resume, settings fieldset, Help, Restart round, Give up, Leave to title) and Results (art, score table, stats line, achievements, Retry, Next stage/lesson or Journey, Title). Overlays: 3-2-1 countdown, toasts (role=status, 2.5–6 s), audio caption strip.

**Layout.**
- ≥ 1024 px wide: three-column grid — Objective rail (150–220 px: goal, hidden count, deals left, score formula, moves/invalid), playfield, Status rail; top bar (☰, title, clock) and bottom tray (Undo, Hint, Deal).
- < 1024 px (portrait or landscape): rails hidden; portrait gives the playfield ≥ 55 dvh.
- Landscape ≤ 500 px tall: top bar 40 px and tray 48 px; title/results art hidden so controls stay on screen.
- Safe areas: the shell pads all four `env(safe-area-inset-*)`; `viewport-fit=cover`.
- The board layout (`computeLayout`) fits ten columns to the playfield width and compresses card overlap so the longest column always fits the height; nothing on the table scrolls or clips. Menus scroll vertically (`justify-content: safe center`) so the Back button is always reachable.

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

**Shape and type.** 8–14 px radii on cards, pads and modals; 1.5 px card borders (2.5 px in high contrast); system-ui sans throughout, tabular numerals for clocks and scores, uppercase 0.08 em tracking for rail titles. Card faces are procedural 128x180 canvas textures (rank top-left, glyph centre, mirrored index bottom-right); card backs use the theme felt with five gold thread curves.

**Motion.** Card poses tween 180 ms cubic-out to authored end states (never cumulative per-frame lerp); a lifted run sits 6 units above the table; bursts are pooled quads with 500 ms life, capped per tier (0 / 200 / 600). With **Reduced motion** on, all tweens snap, the countdown is skipped, and CSS transitions/animations are disabled.

**Hero.** The table. Key art appears only on the title (`assets/key-art.webp`) and the results modal (`results-win.webp` for a win, `results-over.webp` for a loss/abandon); both are decorative `<img>` elements that remove themselves if they fail to load.

**Visual assets the design calls for**: title key art, two results illustrations, store cover, icon/favicon — all shipped (see §15). No 3D model is required: the table, cards and markers are procedural geometry.

## 9. Audio direction

**Mix.** Four gain buses under a master (`music`, `effects`, `ambience`, `voice`) with sliders 0–1 and a mute; defaults 0.6 / 0.8 / 0.4 / 0.8. The context starts on the first pointer/key gesture, suspends when the tab is hidden, resumes on return. Every cue also prints a caption ("♪ web complete!") for 1.6 s so nothing is audio-only.

**Ambience.** A synthesized low-passed noise bed starts immediately; `sfx/ambience-study.opus` (12 s study room tone) loads in the background and replaces it as a loop at 0.6 gain on the ambience bus.

**Music.** `assets/audio/music_gameplay.mp3` loops at 0.35 gain under procedural triangle-wave plucks on a C-major pentatonic set (C4 D4 E4 G4 A4 C5, octave jump 20 %); pluck probability and density rise with `webs / webGoal`, the inter-beat interval shrinking from 1400 ms to 800 ms.

**Effects hierarchy.** input acknowledgement < legal move < flip/deal < web complete < round end; clips are loudness-normalised to −20 LUFS. Each event plays its authored clip when decoded and otherwise a synthesized stand-in (`AudioEngine.event`).

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
| `ambience` | `ambience-study.opus` | Study room tone: clock, distant birds, warm hum | 12 s loop on the ambience bus |

## 10. Localization

**Shipped:** English only (`<html lang="en">`; all strings are inline literals in `js/ui.js`, `js/content.js` and `js/audio.js` captions). There is no locale detection, string table or language setting. The required locale set — en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT — is design intent (see §17). Layout already tolerates ~35 % string growth: buttons are content-sized with 44 px minimums, the title row wraps, rails and menus scroll, and the top title truncates with an ellipsis rather than overflowing.

## 11. Accessibility

- **Keyboard-only path**: title → Play → mode → Start (all real buttons, `focus-visible` 3 px outline in the theme select colour) → board `role="application"` receives focus automatically; arrows/Enter/Space/D/H/U/Escape cover every round action; modals trap Escape, focus their first control and restore focus on close.
- **Screen reader**: every card button is labelled ("Column 3: 7 of Jade thread, run of 4"), pads ("Column 5 (empty)"), stock packets and foundations; a polite live region announces round start, hints, invalid reasons, web completion, achievements and results; toasts use `role="status"`.
- **Captions**: every audio cue writes a caption strip; nothing is conveyed by sound alone.
- **Contrast**: ink on paper ≥ 10:1 in every light theme; **High contrast** raises contrast 15 % and thickens card borders; **Larger text** scales the shell 1.2×; **Left-handed** mirrors the tray order.
- **Colour vision**: three CVD palettes; thread glyphs are always present.
- **Reduced motion**: no tweens, no particles, no countdown; also honoured by the renderer.
- **Targets**: all buttons ≥ 44×44 px; cards are full-size buttons; haptics (`navigator.vibrate`) can be switched off.

## 12. StarHermit integration

Conventions follow https://wiki.starhermit.com/ (manifest, `launch_token`, `/api/v1/*`).

| Feature | Status | Where |
|---|---|---|
| Manifest | Used: `name`, `launch`, `owner`, `server`, `cover` | `starhermit.txt` |
| Identity | Anonymous local id `eightwebs:player`; a `launch_token` query parameter is forwarded as a Bearer header and never persisted | `Platform` |
| Hosted detection | `GET /api/v1/time` must succeed; otherwise every hosted call is a local no-op | `Platform.syncServerTime` |
| Server clock | Round-trip-adjusted offset stamps replay envelopes | `serverOffsetMs` |
| Leaderboards | Ranked content (Daily, Mastery stages, Challenges) POSTs `{board, envelope}` to `/api/v1/score`; boards are `daily:<UTC day>` or `global:<n>suit`; the server replays the envelope, checks the claimed total/status, rejects sub-150 ms-per-move play, keeps the top 100 and returns rank. Scores screen shows today's daily board (top 20) | `submitScore`, `server.js` |
| Achievements | Local first; new keys POSTed to `/api/v1/achievements` (server validates keys, idempotent) | `reportAchievements` |
| Sessions / presence | Not used by the client. The server also exposes `/api/v1/daily/start|command|session/:id` (authoritative daily sessions) and the legacy `/api/session`, `/api/settings`, `/api/game/*` routes from `starhermit_zh.txt`; the browser plays dailies locally and submits the envelope instead | `server.js` |
| Telemetry | Stubbed: `Platform.telemetry` only beacons with explicit consent, and nothing sets `consent = true` | `platform.js` |
| Multiplayer | None; competition is asynchronous through the boards | — |

## 13. Technical architecture

- **Layering**: `rules.js` (pure) ← `content.js` ← `session.js` ← `ui.js` / `render.js` / `audio.js` ← `main.js`. Rules never import the DOM; render and audio consume immutable snapshots and events only.
- **Event flow**: `UI` → `Session.tapCard/deal/undo` → `applyCommand` → events → `UI.onEvent` (audio, toasts, announcements, `renderer.eventFx`) → `syncBoard` rebuilds the ≤104 DOM buttons and calls `renderer.sync`.
- **Determinism**: three independent seeded streams — rules (`deck:<seed>`), decor (`decor:table`), audio variants (`audio:variants`) — so cosmetics never touch rules RNG.
- **Persistence (localStorage)**: `eightwebs:settings`, `eightwebs:progress`, `eightwebs:history` (last 50), `eightwebs:autosave` (def + serialized state + commands, written after every action, on pause, on background and on leave; cleared at round end), `eightwebs:player`.
- **Clock**: `Session.nowMs` accumulates only while active; `elapsedMs` is stamped into each command; the UI ticks once a second and dispatches a `note` heartbeat when a limit expires so the loss is applied by the rules engine.
- **Renderer**: orthographic camera whose frustum is the playfield in CSS pixels, so DOM buttons and meshes share `computeLayout`; 104 pooled card meshes, 12 marker quads, key + ambient light, shadow map on medium/high; pixel ratio `min(dpr, 2) × renderScale` (0.66 / 0.85 / 1.0); context loss is handled by rebuilding the pool; hidden tabs stop rendering. If `WebGLRenderer` throws, a compat note appears and the DOM table is the game.
- **Performance budgets**: ≤ 104 card buttons rebuilt per action (no per-frame DOM work); ≤ 600 particles; textures cached per (rank, thread, theme); 180 ms authored tweens; no network on the play path.
- **Server**: Node 20 `node:http`, JSON store in `.server-data/store.json`, per-key rate limits (starts 30/min, commands 240/min, scores 20/min → HTTP 429), 64 KB body cap, refuses paths outside the repo root.
- **E2E**: `tests/e2e.mjs` serves the repo with its own static server (`PORT` pins it, `BASE_URL` targets an external one), drives real buttons/cards in headless Chrome, reads `window.__eightwebs.session` only to choose which visible element to click next, and fails on any non-benign console error at 1280x800 and 390x844 (touch).

## 14. Testing and acceptance criteria

**`npm test` (31 tests, `tests/run-tests.mjs`)**: deck composition per thread count; opening layout; seed determinism; every illegality reason; `isMovableRun`/`topRunLength`; move immutability; flips; run collection; win with scoring components; deal rules and stock-empty rejection; command id idempotence; invalid actions recorded; move/time/no-moves/give-up terminals; round-over rejection; hint legality; serialize/deserialize; hash stability; 20-seed replay property; fuzzed malformed commands; session undo replayability; bad undo markers; golden terminal hashes; `compareResults` ordering; content counts (5/40/4/3/5); daily immutability; offline validators over all lessons, stages, challenges, 14 dailies and 9 practice seeds (lessons must win, nothing soft-locks).

**`npm run test:e2e`** (both viewports): title renders → Learn lists 5 lessons → lesson 1 is won through two real card clicks and persists `lessonsDone` → Journey lists 40 stages with stage 2 locked → stage 1 countdown reaches `active` with a visible Deal button → `D` deals, hint-chosen moves are clicked on real cards/pads and the move counter matches → Hint dashes a card, Undo reverts a move → Escape pauses, autosave exists, Reduced motion and Theme settings apply and revert → Give up shows "Round abandoned" with a five-row breakdown → Title.

**Product QA bar as checkable statements**: first contact offers instructions (Help) and guided lessons; every mode, setting, hint, undo, deal, pause, resume, restart, give-up, resume-saved and results path is reachable by clicking; no console errors or warnings in the e2e run; no element clipped at 1280x800, 390x844 portrait, or ≤ 500 px-tall landscape (rails collapse, art hides, menus scroll); ranked results reach StarHermit boards when hosted.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200x675, 352 KB) | Store cover: key art crop, title + tagline typeset with ffmpeg drawtext | FLUX.2 klein seed 3101 + ffmpeg | generated in this pass (replaced generic template) |
| `assets/key-art.webp` (1280x720, 53 KB) | Title-screen hero image | FLUX.2 klein, seed 3101, 1536x864, 28 steps | generated in this pass, wired |
| `assets/results-win.webp` (960x540, 75 KB) | Results modal on a win | FLUX.2 klein, seed 3102, 960x544 | generated in this pass, wired |
| `assets/results-over.webp` (960x540, 18 KB) | Results modal on loss/abandon | FLUX.2 klein, seed 3103, 960x544 | generated in this pass, wired |
| `icon.png`, `favicon.svg` | Launcher/tab icons | authored | shipped |
| `assets/audio/music_gameplay.mp3` | Looped music bed | bundled | shipped |
| `assets/audio/sound_tap.mp3`, `sound_miss.mp3` | Secondary fallbacks for `select` / `invalid` | bundled | shipped |
| `sfx/*.opus` × 12 (`card-select` … `clock-tick`) | Core event clips (§9) | MOSS-SFX v2.0, 100 steps | shipped |
| `sfx/clock-warning.opus`, `achievement-unlock.opus`, `lesson-step.opus`, `pause-open.opus`, `ambience-study.opus` | New event clips + ambience loop (§9) | MOSS-SFX v2.0, 100 steps | generated in this pass, wired |
| `sfx/manifest.txt` / `manifest.json` / `manifest.md` | Canonical clip table / generator input / generated summary | authored / tool | shipped |
| `vendor/three.*.js` | Three.js r185 | MIT | shipped |
| 3D model / character animation | — | not required (procedural table, no humanoid) | n/a |

## 16. Known limitations

- Journey stages carry a `theme` per web, but the table always uses the player's Theme setting; stage themes are not applied automatically.
- The **Hold to drag** and camera-preset settings are stored but have no effect; the **Voice volume** bus has no content.
- Localization is English only (§10).
- The client plays dailies locally and submits the envelope afterwards; the server's authoritative daily-session routes are unused, and only today's daily board is ever displayed (global boards are written but not shown).
- Custom seeds in Practice always use Single Thread.
- A lesson's final "Lesson complete when the web clears!" toast can briefly overlap the results modal's buttons (it expires after 3 s).
- Under software WebGL (SwiftShader in the e2e run) the canvas renders only a dark partial region; the DOM table remains the interactive layer, so play is unaffected. On devices without WebGL a compat note appears and the DOM table is the game.
- Telemetry never sends because consent is never granted.
- The keyboard focus cursor can land on a face-down index; the disabled button does not take focus until the cursor moves on.

## 17. Design intent not yet implemented

- Ship the nine required locales with a string table and a language setting (auto-detect from `navigator.language`, en-US fallback).
- Apply each Journey web's theme on stage start (with the player's setting as an override).
- Show global `global:<n>suit` boards and the player's own rank on the Scores screen.
- Make **Hold to drag** switch between tap-to-lift and press-and-hold lifting.
- Play dailies through `/api/v1/daily/*` when hosted so reconnects restore server-side state.
