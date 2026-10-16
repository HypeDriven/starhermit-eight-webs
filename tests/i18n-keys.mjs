// Key extraction for the i18n coverage test (also handy for listing keys).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUITS, THEMES, LESSONS, JOURNEY, CHALLENGES, PRACTICE_DIFFICULTIES, ACHIEVEMENTS } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  // T('…'), N('…'), tr('…') (gfx summary), tx(tag, cls, '…') and this.button('…');
  // ternary keys are wrapped in N() at the call site.
  const patterns = [
    /(?<![\w.$])(?:T|N|tr)\(\s*'((?:[^'\\\n]|\\.)*)'/g,
    /(?<![\w.$])tx\([^,()]+,\s*[^,()]+,\s*'((?:[^'\\\n]|\\.)*)'/g,
    /\bbutton\(\s*'((?:[^'\\\n]|\\.)+)'/g,
    /\bmodal\(\s*'((?:[^'\\\n]|\\.)+)'/g,
    /\bdataset\.i18n(?:Aria)? = '((?:[^'\\\n]|\\.)+)'/g,
  ];
  for (const f of readdirSync(join(ROOT, 'js'))) {
    if (!f.endsWith('.js') || f === 'i18n.js') continue;
    const src = readFileSync(join(ROOT, 'js', f), 'utf8');
    for (const re of patterns) for (const m of src.matchAll(re)) keys.add(unescape(m[1]));
    // Audio captions (ui.caption translates them).
    if (f === 'audio.js') for (const m of src.matchAll(/this\.caption\('([^']+)'\)/g)) keys.add(m[1]);
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
