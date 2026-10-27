// Key extraction for the i18n coverage test (also handy for listing keys).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUITS, THEMES, LESSONS, JOURNEY, CHALLENGES, PRACTICE_DIFFICULTIES, ACHIEVEMENTS } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  // T("…") / N("…") in the engine client (native/*.ts) and T('…') / N('…') in js/;
  // ternary keys are wrapped in N() at the call site.
  const patterns = [
    /(?<![\w.$])(?:T|N)\(\s*'((?:[^'\\\n]|\\.)*)'/g,
    /(?<![\w.$])(?:T|N)\(\s*"((?:[^"\\\n]|\\.)*)"/g,
  ];
  const files = [
    ...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js') && f !== 'i18n.js').map((f) => join(ROOT, 'js', f)),
    ...readdirSync(join(ROOT, 'native')).filter((f) => f.endsWith('.ts')).map((f) => join(ROOT, 'native', f)),
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const re of patterns) for (const m of src.matchAll(re)) keys.add(unescape(m[1]));
    // Sound captions (main.ts translates them where they are shown).
    if (file.endsWith('audio.ts')) {
      const block = src.slice(src.indexOf('export const CAPTIONS'), src.indexOf('};', src.indexOf('export const CAPTIONS')));
      for (const m of block.matchAll(/:\s*"([^"]+)"/g)) keys.add(m[1]);
    }
  }
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (...v) => v.forEach((s) => { if (typeof s === 'string' && s) keys.add(s); });
  for (const s of SUITS) add(s.name);
  for (const t of THEMES) add(t.name);
  for (const l of LESSONS) { add(l.title, l.goals?.note); for (const s of l.tutorial.steps) add(s.text); }
  for (const j of JOURNEY) { add(j.title.replace(/^\d+\. /, ''), j.goals?.note); }
  for (const d of PRACTICE_DIFFICULTIES) add(d.name, d.note);
  for (const c of CHALLENGES) add(c.name, c.note);
  for (const a of ACHIEVEMENTS) add(a.name, a.desc);
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
