// The look of the menus, HUD and dialogs: the browser build's style sheet,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (checkboxes, selects, text
// fields, dialogs, scroll bars) take. The table theme (Settings › Theme)
// recolours everything as the old shell's CSS variables did: its colours are
// the sheet's tokens, with the opacities and tints the old rules applied to
// them precomputed here.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";
import type { Theme } from "./render.ts";

type Tokens = Record<string, string | number>;

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex(rgb: readonly number[]): string {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
/** The colour darkened by `k` (0–1), as the old filter: brightness(1 − k). */
export function darken(c: string, k: number): string { return toHex(hex(c).map((v) => v * (1 - k))); }
/** The colour mixed into another (CSS color-mix in srgb). */
export function mix(a: string, b: string, k: number): string {
  const x = hex(a), y = hex(b);
  return toHex(x.map((v, i) => v * (1 - k) + y[i]! * k));
}

/** The shell's colours for a table theme (ui.js applySettings set them as CSS variables). */
export function themeTokens(t: Theme): Tokens {
  return {
    paper: t.paper, ink: t.ink, rule: t.rule, panel: t.panel, felt: t.felt, accent: t.accent, select: t.select, legal: t.legal, danger: t.danger,
    "ink-dim": t.ink + "a6", "ink-soft": t.ink + "b3", "ink-faint": t.ink + "99",
    "panel-hover": darken(t.panel, 0.03), "panel-press": darken(t.panel, 0.06), "accent-hover": darken(t.accent, 0.05),
    "accent-soft": t.accent + "24", "on-accent": "#ffffff",
  };
}

let current: Theme | null = null;
export function initStyles(t: Theme): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$select", width: 3, offset: 2 } },
    checkbox: {
      text: { color: "$ink" }, minHeight: 44,
      parts: { box: { background: "#ffffff", border: { width: 1, color: "$rule" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { text: { color: "$ink" }, background: "$panel", border: { width: 1, color: "$rule" }, radius: 8, minHeight: 36 },
    textField: { text: { color: "$ink" }, background: "#ffffff", border: { width: 1, color: "$rule" }, radius: 8, minHeight: 44 },
    dialog: {
      background: "$panel", radius: 14, padding: { top: 19, bottom: 19, start: 22, end: 22 },
      shadow: { y: 12, blur: 40, color: "#00000066" },
      parts: { backdrop: { background: "#0a0a108c" } },
    },
    scrollArea: { parts: { bar: { background: "$ink-faint", radius: 4 } } },
    tooltip: { background: "$ink", text: { color: "$paper" }, radius: 6, padding: 6 },
  });
  applyTheme(t);
}
/** The table theme's colours over the sheet's tokens and the runtime's widgets. */
export function applyTheme(t: Theme): void {
  if (current && current.id === t.id) return;
  current = t;
  ui.setTokens(themeTokens(t));
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 10,
    text: t.ink, muted: t.ink + "a6", panel: t.panel, control: t.panel, hovered: darken(t.panel, 0.03),
    pressed: darken(t.panel, 0.06), field: "#ffffff", accent: t.accent, focus: t.select, outline: t.rule,
  });
}
