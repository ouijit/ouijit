// The marks of a cover come from one of these systems. Each is a pure function
// of its parameters, so a frontmatter spec always renders the same cover.

export const COVER_W = 800;
export const COVER_H = 450;

export const WASH_STOPS = {
  prism: [
    'oklch(80% 0.13 295)',
    'oklch(79% 0.13 330)',
    'oklch(78% 0.14 15)',
    'oklch(79% 0.14 45)',
    'oklch(84% 0.13 80)',
    'oklch(86% 0.14 130)',
  ],
  iris: ['oklch(80% 0.13 295)', 'oklch(78% 0.12 250)', 'oklch(83% 0.11 190)', 'oklch(86% 0.14 130)'],
  graphite: ['oklch(30% 0.011 285)', 'oklch(46% 0.013 285)', 'oklch(24% 0.01 285)'],
} as const;

export type Wash = keyof typeof WASH_STOPS;

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strong?: boolean;
  dash?: string;
  w?: number;
}
export interface Dot {
  cx: number;
  cy: number;
  r: number;
  strong?: boolean;
}
export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  strong?: boolean;
  dash?: string;
}
export interface Marks {
  lines: Line[];
  dots: Dot[];
  ellipses: Ellipse[];
}

export type System =
  | { motif: 'fan'; count?: number; x?: number; y0?: number; y1?: number; tx?: number; ty?: number; spread?: number }
  | {
      motif: 'rows';
      count?: number;
      y0?: number;
      y1?: number;
      x0?: number;
      x1?: number;
      breakAt?: number;
      gap?: number;
    }
  | {
      motif: 'dots';
      cols?: number;
      rows?: number;
      x0?: number;
      x1?: number;
      y0?: number;
      y1?: number;
      swellAt?: number;
    }
  | { motif: 'columns'; count?: number; x0?: number; y0?: number; y1?: number; strong?: number; loosen?: number }
  | {
      motif: 'coil';
      count?: number;
      cx?: number;
      cy?: number;
      step?: number;
      rx?: number;
      ry?: number;
      solid?: number;
    };

export function coverMarks(system: System): Marks {
  const marks: Marks = { lines: [], dots: [], ellipses: [] };

  if (system.motif === 'fan') {
    const { count = 23, x = 60, y0 = 50, y1 = 410, tx = 690, ty = 330, spread = 0 } = system;
    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const y = y0 + (i * (y1 - y0)) / (count - 1);
      marks.lines.push({
        x1: x,
        y1: y,
        x2: tx,
        y2: ty + (i - mid) * spread,
        strong: spread > 0 && i === Math.round(mid),
      });
    }
    if (spread === 0) {
      for (let k = 1; k < 7; k++) {
        const vx = x + (k * (tx - x)) / 7;
        const t = (vx - x) / (tx - x);
        marks.lines.push({ x1: vx, y1: y0 + t * (ty - y0), x2: vx, y2: y1 + t * (ty - y1) });
      }
      marks.dots.push({ cx: tx, cy: ty, r: 6, strong: true });
    }
  }

  if (system.motif === 'rows') {
    const { count = 16, y0 = 60, y1 = 390, x0 = 60, x1 = 740, breakAt = 520, gap = 28 } = system;
    for (let r = 0; r < count; r++) {
      const y = y0 + (r * (y1 - y0)) / (count - 1);
      let xs = x0;
      while (xs + 12 < breakAt - 20) {
        marks.lines.push({ x1: xs, y1: y, x2: xs + 12, y2: y });
        xs += 12 + Math.max(5, gap - r * 1.4);
      }
      marks.lines.push({ x1: breakAt, y1: y, x2: x1, y2: y, strong: true });
    }
  }

  if (system.motif === 'dots') {
    const { cols = 30, rows = 7, x0 = 300, x1 = 735, y0 = 70, y1 = 274, swellAt = cols - 1 } = system;
    for (let r = 0; r < rows; r++) {
      const cy = y0 + (r * (y1 - y0)) / (rows - 1);
      for (let c = 0; c < cols; c++) {
        const t = 1 - Math.min(1, Math.abs(c - swellAt) / (cols - 1));
        marks.dots.push({
          cx: x0 + (c * (x1 - x0)) / (cols - 1),
          cy,
          r: 1.2 + t * 3.2,
          strong: Math.abs(c - swellAt) < 5,
        });
      }
    }
  }

  if (system.motif === 'columns') {
    const { count = 26, x0 = 60, y0 = 80, y1 = 390, strong = 3, loosen = 0.9 } = system;
    for (let c = 0; c < count; c++) {
      const x = x0 + c * (c * loosen + 12);
      if (x > COVER_W - 60) break;
      marks.lines.push({ x1: x, y1: y0, x2: x, y2: y1, strong: c === strong, w: c === strong ? 2 : 1.5 });
    }
  }

  if (system.motif === 'coil') {
    const { count = 9, cx = 400, cy = 225, step = 52, rx = 26, ry = 100, solid = 6 } = system;
    const start = cx - ((count - 1) * step) / 2;
    for (let i = 0; i < count; i++) {
      marks.ellipses.push({
        cx: start + i * step,
        cy,
        rx,
        ry,
        strong: i === solid,
        dash: i === solid ? undefined : '5 7',
      });
    }
    marks.lines.push({ x1: start - 40, y1: cy, x2: start + (count - 1) * step + 40, y2: cy });
  }

  return marks;
}

// Moves a system's break to a point in cover coordinates, for the live cover.
// Everything else about the system stays as specified, so letting go of the
// pointer returns it to the designed composition.
export function focusSystem(system: System, px: number, py: number): System {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  switch (system.motif) {
    case 'fan': {
      const x = system.x ?? 60;
      const away = x < COVER_W / 2;
      const tx = away ? clamp(px, 440, COVER_W - 60) : clamp(px, 60, COVER_W - 440);
      return { ...system, tx, ty: clamp(py, 60, COVER_H - 60) };
    }
    case 'rows': {
      const x0 = system.x0 ?? 60;
      const x1 = system.x1 ?? 740;
      return { ...system, breakAt: clamp(px, x0 + 140, x1 - 120) };
    }
    case 'dots': {
      const { cols = 30, x0 = 300, x1 = 735 } = system;
      return { ...system, swellAt: Math.round(clamp((px - x0) / (x1 - x0), 0, 1) * (cols - 1)) };
    }
    case 'columns': {
      const { count = 26, x0 = 60, loosen = 0.9 } = system;
      let best = 0;
      for (let c = 0; c < count; c++) {
        const cx = x0 + c * (c * loosen + 12);
        if (cx > COVER_W - 60) break;
        if (Math.abs(cx - px) < Math.abs(x0 + best * (best * loosen + 12) - px)) best = c;
      }
      return { ...system, strong: best };
    }
    case 'coil': {
      const { count = 9, cx = 400, step = 52 } = system;
      const start = cx - ((count - 1) * step) / 2;
      return { ...system, solid: Math.round(clamp((px - start) / step, 0, count - 1)) };
    }
  }
}
