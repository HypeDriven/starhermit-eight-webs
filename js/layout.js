// Eight Webs — the table's layout model (logical px within the playfield
// rect, y down): the ten columns with their fanned cards, the empty-column
// pads, the stock packets and the foundation webs. The card layer
// (native/screens.ts) and the 3D table (native/render.ts) both use it, as
// the browser build's DOM layer and three.js scene did.

export function computeLayout(state, W, H, opts = {}) {
  const narrow = W < 480;
  const gap = narrow ? 3 : Math.max(6, Math.round(W * 0.008));
  const topBar = Math.round(Math.min(H * 0.16, 120));
  const cw = Math.min((W - gap * 11) / 10, (H - topBar - gap * 2) / 3.6);
  const ch = cw * 1.4;
  // Exposed strip of a face-up card = its tap target and its readable rank:
  // never thinner than the rank line, wider on touch screens.
  const minUp = opts.coarse ? 24 : 18;
  const colX = (c) => gap + c * (cw + gap);
  const colY = topBar + gap;
  const avail = H - colY - gap;
  const cols = state.cols.map((col) => {
    let up = Math.max(ch * 0.32, minUp), dn = ch * 0.16;
    const natural = col.reduce((h, c, i) => h + (i === 0 ? ch : c.u ? up : dn), 0);
    if (natural > avail && col.length > 1) {
      // Compress face-down cards first, then face-up ones down to the rank line.
      const over = (natural - avail) / (col.length - 1);
      dn = Math.max(4, dn - over);
      const stillOver = col.reduce((h, c, i) => h + (i === 0 ? ch : c.u ? up : dn), 0) - avail;
      if (stillOver > 0) {
        const ups = col.filter((c, i) => i > 0 && c.u).length || 1;
        // 13px keeps the rank line legible; below that the column would clip
        up = Math.max(Math.min(minUp, 13), up - stillOver / ups);
      }
    }
    const rects = [];
    let y = colY;
    for (let i = 0; i < col.length; i++) {
      rects.push({ x: colX(state.cols.indexOf(col)), y, w: cw, h: ch });
      y += col[i].u ? up : dn;
    }
    return rects;
  });
  // Recompute x by index (indexOf above is unsafe with duplicate empties).
  state.cols.forEach((col, c) => { for (const r of cols[c]) r.x = colX(c); });
  const pads = state.cols.map((col, c) => ({ x: colX(c), y: colY, w: cw, h: Math.max(ch, col.length ? (cols[c].at(-1).y + ch - colY) : ch) }));
  const stock = state.stock.map((_, i) => ({ x: gap + i * (cw * 0.35), y: gap, w: cw * 0.8, h: ch * 0.8 }));
  const foundations = [];
  for (let i = 0; i < 8; i++) {
    foundations.push({ x: W - gap - (8 - i) * (cw * 0.62), y: gap, w: cw * 0.55, h: ch * 0.8 });
  }
  return { cw, ch, gap, topBar, cols, pads, stock, foundations, W, H };
}
