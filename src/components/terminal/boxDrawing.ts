import type { Terminal, GhosttyCell } from 'ghostty-web';
import log from 'electron-log/renderer';

const boxDrawingLog = log.scope('boxDrawing');

// ── Why this exists ──────────────────────────────────────────────────
// ghostty-web's CanvasRenderer draws every cell — including box-drawing
// (U+2500–257F) and block (U+2580–259F) characters — with ctx.fillText()
// using the font glyph. Its cell box is `ceil(ascent + descent) + 2` tall
// (2px of leading the glyph doesn't fill), so vertical rules can't reach the
// next row and borders render as dashed/broken lines. Native Ghostty and the
// xterm.js renderer we migrated off both draw these glyphs as geometry tiled
// exactly to the cell. This module restores that: it intercepts the renderer's
// per-cell text pass, draws the covered codepoints procedurally so they tile
// seamlessly, and delegates everything else back to ghostty-web unchanged.
//
// Coverage: light/heavy/mixed box lines, corners, T-junctions, crosses,
// rounded corners, dashes, half-stubs, diagonals, straight double lines
// (═ ║), and the full block range (halves, eighths, quadrants, shades).
// Double-line corners/junctions (U+2552–256C) fall back to the font glyph —
// their junction geometry isn't handled yet, so they render as they did before
// (no regression).

const CellFlag = {
  UNDERLINE: 4,
  INVERSE: 16,
  INVISIBLE: 32,
  FAINT: 128,
} as const;

// Arm weights per codepoint, ordered [up, right, down, left].
// 0 = none, 1 = light, 2 = heavy. Double-line arms are handled separately.
const ARMS: Record<number, [number, number, number, number]> = {
  0x2500: [0, 1, 0, 1],
  0x2501: [0, 2, 0, 2],
  0x2502: [1, 0, 1, 0],
  0x2503: [2, 0, 2, 0],
  0x250c: [0, 1, 1, 0],
  0x250d: [0, 2, 1, 0],
  0x250e: [0, 1, 2, 0],
  0x250f: [0, 2, 2, 0],
  0x2510: [0, 0, 1, 1],
  0x2511: [0, 0, 1, 2],
  0x2512: [0, 0, 2, 1],
  0x2513: [0, 0, 2, 2],
  0x2514: [1, 1, 0, 0],
  0x2515: [1, 2, 0, 0],
  0x2516: [2, 1, 0, 0],
  0x2517: [2, 2, 0, 0],
  0x2518: [1, 0, 0, 1],
  0x2519: [1, 0, 0, 2],
  0x251a: [2, 0, 0, 1],
  0x251b: [2, 0, 0, 2],
  0x251c: [1, 1, 1, 0],
  0x251d: [1, 2, 1, 0],
  0x251e: [2, 1, 1, 0],
  0x251f: [1, 1, 2, 0],
  0x2520: [2, 1, 2, 0],
  0x2521: [2, 2, 1, 0],
  0x2522: [1, 2, 2, 0],
  0x2523: [2, 2, 2, 0],
  0x2524: [1, 0, 1, 1],
  0x2525: [1, 0, 1, 2],
  0x2526: [2, 0, 1, 1],
  0x2527: [1, 0, 2, 1],
  0x2528: [2, 0, 2, 1],
  0x2529: [2, 0, 1, 2],
  0x252a: [1, 0, 2, 2],
  0x252b: [2, 0, 2, 2],
  0x252c: [0, 1, 1, 1],
  0x252d: [0, 1, 1, 2],
  0x252e: [0, 2, 1, 1],
  0x252f: [0, 2, 1, 2],
  0x2530: [0, 1, 2, 1],
  0x2531: [0, 1, 2, 2],
  0x2532: [0, 2, 2, 1],
  0x2533: [0, 2, 2, 2],
  0x2534: [1, 1, 0, 1],
  0x2535: [1, 1, 0, 2],
  0x2536: [1, 2, 0, 1],
  0x2537: [1, 2, 0, 2],
  0x2538: [2, 1, 0, 1],
  0x2539: [2, 1, 0, 2],
  0x253a: [2, 2, 0, 1],
  0x253b: [2, 2, 0, 2],
  0x253c: [1, 1, 1, 1],
  0x253d: [1, 1, 1, 2],
  0x253e: [1, 2, 1, 1],
  0x253f: [1, 2, 1, 2],
  0x2540: [2, 1, 1, 1],
  0x2541: [1, 1, 2, 1],
  0x2542: [2, 1, 2, 1],
  0x2543: [2, 1, 1, 2],
  0x2544: [2, 2, 1, 1],
  0x2545: [1, 1, 2, 2],
  0x2546: [1, 2, 2, 1],
  0x2547: [2, 2, 1, 2],
  0x2548: [1, 2, 2, 2],
  0x2549: [2, 1, 2, 2],
  0x254a: [2, 2, 2, 1],
  0x254b: [2, 2, 2, 2],
  // Half-line stubs.
  0x2574: [0, 0, 0, 1],
  0x2575: [1, 0, 0, 0],
  0x2576: [0, 1, 0, 0],
  0x2577: [0, 0, 1, 0],
  0x2578: [0, 0, 0, 2],
  0x2579: [2, 0, 0, 0],
  0x257a: [0, 2, 0, 0],
  0x257b: [0, 0, 2, 0],
  0x257c: [0, 2, 0, 1],
  0x257d: [1, 0, 2, 0],
  0x257e: [0, 1, 0, 2],
  0x257f: [2, 0, 1, 0],
};

// Dashed lines: codepoint -> [axis, weight, dashCount].
const DASHES: Record<number, ['h' | 'v', number, number]> = {
  0x2504: ['h', 1, 3],
  0x2505: ['h', 2, 3],
  0x2506: ['v', 1, 3],
  0x2507: ['v', 2, 3],
  0x2508: ['h', 1, 4],
  0x2509: ['h', 2, 4],
  0x250a: ['v', 1, 4],
  0x250b: ['v', 2, 4],
  0x254c: ['h', 1, 2],
  0x254d: ['h', 2, 2],
  0x254e: ['v', 1, 2],
  0x254f: ['v', 2, 2],
};

const ROUNDED = new Set([0x256d, 0x256e, 0x256f, 0x2570]);
const DIAGONALS = new Set([0x2571, 0x2572, 0x2573]);

// Quadrant membership for block characters [UL, UR, LL, LR].
const QUADRANTS: Record<number, [boolean, boolean, boolean, boolean]> = {
  0x2596: [false, false, true, false],
  0x2597: [false, false, false, true],
  0x2598: [true, false, false, false],
  0x2599: [true, false, true, true],
  0x259a: [true, false, false, true],
  0x259b: [true, true, true, false],
  0x259c: [true, true, false, true],
  0x259d: [false, true, false, false],
  0x259e: [false, true, true, false],
  0x259f: [false, true, true, true],
};

interface RendererInternals {
  renderCellText(cell: GhosttyCell, col: number, row: number): void;
  getCanvas(): HTMLCanvasElement;
  getMetrics(): { width: number; height: number; baseline: number };
  fontSize?: number;
  __seamlessBoxPatched?: boolean;
}

function isHandledCodepoint(cp: number): boolean {
  if (cp in ARMS || cp in DASHES || cp in QUADRANTS) return true;
  if (ROUNDED.has(cp) || DIAGONALS.has(cp)) return true;
  if (cp === 0x2550 || cp === 0x2551) return true; // straight double lines
  if (cp >= 0x2580 && cp <= 0x2595) return true; // halves / eighths / shades
  return false;
}

/**
 * Draw a supported box-drawing or block glyph filling the whole cell.
 * Returns true if the codepoint was handled, false to fall back to the font.
 */
function drawGlyph(renderer: RendererInternals, cell: GhosttyCell, col: number, row: number): boolean {
  const cp = cell.codepoint;
  if (!isHandledCodepoint(cp)) return false;

  const canvas = renderer.getCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const m = renderer.getMetrics();
  const dpr = window.devicePixelRatio || 1;

  // Tile in device pixels so adjacent cells share exact edges (no seams).
  const cw = cell.width || 1;
  const X = Math.round(col * m.width * dpr);
  const right = Math.round((col + cw) * m.width * dpr);
  const Y = Math.round(row * m.height * dpr);
  const bottom = Math.round((row + 1) * m.height * dpr);
  const W = right - X;
  const H = bottom - Y;
  const CX = X + Math.round(W / 2);
  const CY = Y + Math.round(H / 2);

  const fontSize = renderer.fontSize ?? m.height / 1.2;
  const lightT = Math.max(1, Math.round((fontSize / 16) * dpr));
  const heavyT = Math.max(lightT + 1, Math.round((fontSize / 8) * dpr));

  const inverse = (cell.flags & CellFlag.INVERSE) !== 0;
  const r = inverse ? cell.bg_r : cell.fg_r;
  const g = inverse ? cell.bg_g : cell.fg_g;
  const b = inverse ? cell.bg_b : cell.fg_b;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.strokeStyle = ctx.fillStyle;
  if (cell.flags & CellFlag.FAINT) ctx.globalAlpha = 0.5;

  try {
    if (cp >= 0x2580 && cp <= 0x259f) {
      drawBlock(ctx, cp, X, Y, W, H);
    } else if (cp === 0x2550 || cp === 0x2551) {
      drawDouble(ctx, cp, X, Y, W, H, CX, CY, lightT, dpr);
    } else if (cp in DASHES) {
      const [axis, weight, count] = DASHES[cp];
      drawDashed(ctx, axis, count, weight === 2 ? heavyT : lightT, X, Y, W, H, CX, CY);
    } else if (ROUNDED.has(cp)) {
      drawRounded(ctx, cp, X, Y, W, H, lightT);
    } else if (DIAGONALS.has(cp)) {
      drawDiagonal(ctx, cp, X, Y, W, H, lightT);
    } else {
      drawArms(ctx, ARMS[cp], X, Y, W, H, CX, CY, lightT, heavyT);
    }
  } finally {
    ctx.restore();
  }
  return true;
}

function drawArms(
  ctx: CanvasRenderingContext2D,
  arms: [number, number, number, number],
  X: number,
  Y: number,
  W: number,
  H: number,
  CX: number,
  CY: number,
  lightT: number,
  heavyT: number,
): void {
  const [u, rt, d, l] = arms;
  const th = (w: number) => (w === 2 ? heavyT : lightT);

  if (l) ctx.fillRect(X, CY - (th(l) >> 1), CX - X, th(l));
  if (rt) ctx.fillRect(CX, CY - (th(rt) >> 1), X + W - CX, th(rt));
  if (u) ctx.fillRect(CX - (th(u) >> 1), Y, th(u), CY - Y);
  if (d) ctx.fillRect(CX - (th(d) >> 1), CY, th(d), Y + H - CY);

  const count = (u ? 1 : 0) + (rt ? 1 : 0) + (d ? 1 : 0) + (l ? 1 : 0);
  if (count >= 2) {
    // Fill the junction so corners and crosses join solidly.
    const tv = Math.max(u ? th(u) : 0, d ? th(d) : 0, lightT);
    const tc = Math.max(l ? th(l) : 0, rt ? th(rt) : 0, lightT);
    ctx.fillRect(CX - (tv >> 1), CY - (tc >> 1), tv, tc);
  }
}

function drawDashed(
  ctx: CanvasRenderingContext2D,
  axis: 'h' | 'v',
  count: number,
  t: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  CX: number,
  CY: number,
): void {
  if (axis === 'h') {
    const slot = W / count;
    const dash = slot * 0.6;
    for (let i = 0; i < count; i++) {
      ctx.fillRect(Math.round(X + i * slot + (slot - dash) / 2), CY - (t >> 1), Math.max(1, Math.round(dash)), t);
    }
  } else {
    const slot = H / count;
    const dash = slot * 0.6;
    for (let i = 0; i < count; i++) {
      ctx.fillRect(CX - (t >> 1), Math.round(Y + i * slot + (slot - dash) / 2), t, Math.max(1, Math.round(dash)));
    }
  }
}

function drawRounded(
  ctx: CanvasRenderingContext2D,
  cp: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  t: number,
): void {
  const rx = W / 2;
  const ry = H / 2;
  ctx.lineWidth = t;
  ctx.beginPath();
  if (cp === 0x256d) ctx.ellipse(X + W, Y + H, rx, ry, 0, Math.PI, 1.5 * Math.PI);
  else if (cp === 0x256e) ctx.ellipse(X, Y + H, rx, ry, 0, 1.5 * Math.PI, 2 * Math.PI);
  else if (cp === 0x256f) ctx.ellipse(X, Y, rx, ry, 0, 0, 0.5 * Math.PI);
  else ctx.ellipse(X + W, Y, rx, ry, 0, 0.5 * Math.PI, Math.PI); // 0x2570
  ctx.stroke();
}

function drawDiagonal(
  ctx: CanvasRenderingContext2D,
  cp: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  t: number,
): void {
  ctx.lineWidth = t;
  ctx.beginPath();
  if (cp === 0x2571 || cp === 0x2573) {
    ctx.moveTo(X, Y + H);
    ctx.lineTo(X + W, Y);
  }
  if (cp === 0x2572 || cp === 0x2573) {
    ctx.moveTo(X, Y);
    ctx.lineTo(X + W, Y + H);
  }
  ctx.stroke();
}

function drawDouble(
  ctx: CanvasRenderingContext2D,
  cp: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  CX: number,
  CY: number,
  t: number,
  dpr: number,
): void {
  const gap = Math.max(t, Math.round(1.5 * dpr));
  if (cp === 0x2550) {
    ctx.fillRect(X, CY - gap - (t >> 1), W, t);
    ctx.fillRect(X, CY + gap - (t >> 1), W, t);
  } else {
    ctx.fillRect(CX - gap - (t >> 1), Y, t, H);
    ctx.fillRect(CX + gap - (t >> 1), Y, t, H);
  }
}

function drawBlock(ctx: CanvasRenderingContext2D, cp: number, X: number, Y: number, W: number, H: number): void {
  const eighth = (n: number, total: number) => Math.round((total * n) / 8);

  if (cp === 0x2580) {
    // Upper half.
    ctx.fillRect(X, Y, W, Math.round(H / 2));
  } else if (cp >= 0x2581 && cp <= 0x2588) {
    // Lower eighths (2581 = 1/8 .. 2588 = full).
    const n = cp - 0x2580;
    const h = eighth(n, H);
    ctx.fillRect(X, Y + H - h, W, h);
  } else if (cp >= 0x2589 && cp <= 0x258f) {
    // Left eighths (2589 = 7/8 .. 258F = 1/8).
    const n = 0x2590 - cp;
    ctx.fillRect(X, Y, eighth(n, W), H);
  } else if (cp === 0x2590) {
    // Right half.
    const w = Math.round(W / 2);
    ctx.fillRect(X + W - w, Y, w, H);
  } else if (cp === 0x2591 || cp === 0x2592 || cp === 0x2593) {
    // Shades.
    const alpha = cp === 0x2591 ? 0.25 : cp === 0x2592 ? 0.5 : 0.75;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.fillRect(X, Y, W, H);
    ctx.globalAlpha = prev;
  } else if (cp === 0x2594) {
    // Upper one eighth.
    ctx.fillRect(X, Y, W, eighth(1, H));
  } else if (cp === 0x2595) {
    // Right one eighth.
    const w = eighth(1, W);
    ctx.fillRect(X + W - w, Y, w, H);
  } else {
    // Quadrants (2596-259F).
    const quads = QUADRANTS[cp];
    if (!quads) return;
    const hw = Math.round(W / 2);
    const hh = Math.round(H / 2);
    const [ul, ur, ll, lr] = quads;
    if (ul) ctx.fillRect(X, Y, hw, hh);
    if (ur) ctx.fillRect(X + hw, Y, W - hw, hh);
    if (ll) ctx.fillRect(X, Y + hh, hw, H - hh);
    if (lr) ctx.fillRect(X + hw, Y + hh, W - hw, H - hh);
  }
}

/**
 * Patch ghostty-web's CanvasRenderer so box-drawing and block glyphs render as
 * geometry that fills the cell. Patches the prototype once, so it applies to
 * every terminal and survives renderer recreation (e.g. font changes). Safe to
 * call repeatedly — only the first call mutates the prototype.
 */
export function installSeamlessBoxDrawing(term: Terminal): void {
  const renderer = (term as unknown as { renderer?: RendererInternals }).renderer;
  if (!renderer) return;

  const proto = Object.getPrototypeOf(renderer) as RendererInternals;
  if (proto.__seamlessBoxPatched) return;
  if (typeof proto.renderCellText !== 'function') {
    boxDrawingLog.warn('renderCellText not found on renderer prototype; box-drawing fix not applied');
    return;
  }

  const original = proto.renderCellText;
  proto.renderCellText = function (this: RendererInternals, cell: GhosttyCell, col: number, row: number): void {
    if (
      cell &&
      cell.codepoint >= 0x2500 &&
      cell.codepoint <= 0x259f &&
      cell.grapheme_len === 0 &&
      !(cell.flags & CellFlag.INVISIBLE) &&
      !(cell.flags & CellFlag.UNDERLINE)
    ) {
      if (drawGlyph(this, cell, col, row)) return;
    }
    original.call(this, cell, col, row);
  };
  proto.__seamlessBoxPatched = true;
  boxDrawingLog.info('installed seamless box-drawing renderer');
}
