// The save's pure parts (node --test): the progress document, the browser
// build's cloud save read and merged into it (the engine shows it as foreign),
// the two-device merge, and the game options with the browser build's
// settings keys they are migrated from. The engine calls around them
// (native/platform.ts: saves, settings, storage) need a signed-in platform and
// are not run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asProgress, checkOption, freshProgress, isBrowserKey, readForeign, OPTION_DEFAULTS } from '../js/progress.js';
import { mergeProgress } from '../js/session.js';

test('a fresh document and partial documents read as full progress', () => {
  const f = freshProgress();
  assert.deepEqual(Object.keys(f).sort(), ['achievements', 'bests', 'daysPlayed', 'journey', 'lessonsDone', 'mastery', 'v', 'websCleared']);
  const p = asProgress({ v: 1, websCleared: 4 });
  assert.equal(p.websCleared, 4);
  assert.deepEqual(p.journey, {});
  assert.equal(asProgress({ v: 2 }), null);
  assert.equal(asProgress(null), null);
  assert.equal(asProgress('x'), null);
});

test('the browser build\'s cloud save (saveJSON text) migrates and merges with this device', () => {
  const old = JSON.stringify({ v: 1, journey: { 'journey-1': { score: 640, at: 10 } }, lessonsDone: { 'learn-1': true }, achievements: { first_web: 7 }, websCleared: 3, daysPlayed: ['2026-09-30'], bests: { 'journey-1': 640 }, mastery: {} });
  const foreign = readForeign(old);
  assert.equal(foreign.journey['journey-1'].score, 640);
  const device = { ...freshProgress(), lessonsDone: { 'learn-2': true }, websCleared: 1, daysPlayed: ['2026-10-27'] };
  const m = asProgress(mergeProgress(foreign, device));
  assert.deepEqual(Object.keys(m.lessonsDone).sort(), ['learn-1', 'learn-2']);
  assert.equal(m.websCleared, 3);
  assert.deepEqual(m.daysPlayed, ['2026-09-30', '2026-10-27']);
  assert.equal(readForeign('not json'), null);
  assert.equal(readForeign(''), null);
});

test('mergeProgress keeps the better side of every record', () => {
  const m = mergeProgress(
    { v: 1, journey: { 'journey-1': { score: 900, at: 1 }, 'journey-2': { score: 100, at: 1 } }, lessonsDone: { 'learn-1': true },
      achievements: { first_web: 5 }, websCleared: 12, daysPlayed: ['2026-10-01'], bests: { a: 10 }, mastery: { m1: true } },
    { v: 1, journey: { 'journey-2': { score: 300, at: 2 }, 'journey-3': { score: 50, at: 2 } }, lessonsDone: { 'learn-2': true },
      achievements: { first_web: 9, streak_5: 3 }, websCleared: 8, daysPlayed: ['2026-10-02'], bests: { a: 5, b: 7 }, mastery: {} });
  assert.deepEqual(Object.keys(m.journey).sort(), ['journey-1', 'journey-2', 'journey-3']);
  assert.equal(m.journey['journey-2'].score, 300);
  assert.deepEqual(Object.keys(m.lessonsDone).sort(), ['learn-1', 'learn-2']);
  assert.deepEqual(m.achievements, { first_web: 5, streak_5: 3 });
  assert.equal(m.websCleared, 12);
  assert.deepEqual(m.daysPlayed, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(m.bests, { a: 10, b: 7 });
  assert.deepEqual(m.mastery, { m1: true });
});

test('game options: valid values pass, the rest are refused; browser keys are recognised', () => {
  assert.equal(checkOption('theme', 'jade'), 'jade');
  assert.equal(checkOption('theme', 'neon'), undefined);
  assert.equal(checkOption('cvd', 'tritan'), 'tritan');
  assert.equal(checkOption('cvd', 1), undefined);
  assert.equal(checkOption('haptics', false), false);
  assert.equal(checkOption('leftHanded', 'yes'), undefined);
  assert.equal(checkOption('volMusic', 0.5), undefined);
  for (const k of Object.keys(OPTION_DEFAULTS)) assert.ok(isBrowserKey(k), k);
  for (const k of ['volMusic', 'muted', 'graphics', 'ui.language', 'audio.options', 'graphics.gpu.AMD']) assert.ok(isBrowserKey(k), k);
  assert.ok(!isBrowserKey('game.theme'));
});
