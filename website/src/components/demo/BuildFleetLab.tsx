import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';

/**
 * Build section lab, round 7 — parallelism as a fleet that multiplies, on a
 * scroll-scrubbed stage rather than a timed theater. No desk and no beat row:
 * the stage pins to the viewport and the layout itself carries the story.
 *
 * Every tile's rectangle is interpolated between whole-grid layouts on each
 * scroll frame, so growth is continuous with the wheel instead of stepping
 * between states.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/* ─── Tiles ───────────────────────────────────────────────────────── */

interface Tile {
  key: string;
  icon: string;
  name: string;
  meta?: string;
  title: string;
  body: string;
  content: ReactNode;
}

const GREEN = 'text-ansi-green';

function Row({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return <div className={`truncate ${dim ? 'text-ink/35' : 'text-ink/70'}`}>{children}</div>;
}

const TILES: Tile[] = [
  {
    key: 'term',
    icon: 'terminal',
    name: 'claude',
    meta: 'T-101',
    title: 'One task, one worktree',
    body: 'Every task gets its own git worktree and terminal. The start hook launches your agent with the task’s prompt already in hand.',
    content: (
      <>
        <Row dim>$ claude &quot;$OUIJIT_TASK_DESCRIPTION&quot;</Row>
        <Row>› Split onboarding into a stepper.</Row>
        <Row dim>Read(src/onboarding/Stepper.tsx)</Row>
        <Row>
          <span className={GREEN}>+92</span> <span className="text-ink/40">/</span>{' '}
          <span className="text-diff-removed">−14</span> lines
        </Row>
      </>
    ),
  },
  {
    key: 'plan',
    icon: 'file-text',
    name: 'plan.md',
    title: 'The plan, docked',
    body: 'Any markdown file docks to a terminal as a live panel, updating as the agent writes it.',
    content: (
      <>
        <Row>
          <Icon name="check" className={`inline !w-3 !h-3 mr-1.5 ${GREEN}`} />
          Stepper shell
        </Row>
        <Row>
          <Icon name="check" className={`inline !w-3 !h-3 mr-1.5 ${GREEN}`} />
          Saved progress
        </Row>
        <Row dim>
          <Icon name="circle-dashed" className="inline !w-3 !h-3 mr-1.5" />
          Retire WelcomeIntro
        </Row>
        <Row dim>
          <Icon name="circle-dashed" className="inline !w-3 !h-3 mr-1.5" />
          Update the e2e
        </Row>
      </>
    ),
  },
  {
    key: 'preview',
    icon: 'globe-simple',
    name: 'localhost:5173',
    title: 'The branch, running',
    body: 'A preview panel points at any URL. Aim one at the dev server and watch this branch run beside its diff.',
    content: (
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="h-1.5 w-1/3 rounded-full bg-ink/25" />
        <div className="flex gap-1.5">
          <span className="h-6 flex-1 rounded bg-accent/25" />
          <span className="h-6 flex-1 rounded bg-ink/10" />
          <span className="h-6 flex-1 rounded bg-ink/10" />
        </div>
        <div className="h-1.5 w-2/3 rounded-full bg-ink/12" />
        <div className="h-1.5 w-1/2 rounded-full bg-ink/12" />
      </div>
    ),
  },
  {
    key: 'diff',
    icon: 'git-branch',
    name: '3 files',
    meta: '+130 −78',
    title: 'The diff, one tab over',
    body: 'Every change on the branch appears as it happens, with your notes anchored to the lines that need them.',
    content: (
      <>
        <Row dim>src/onboarding/Stepper.tsx</Row>
        <div className="px-1 bg-diff-added/10">
          <Row>
            <span className={GREEN}>+</span> const {'{'} step {'}'} = useProgress()
          </Row>
        </div>
        <div className="px-1 bg-diff-removed/[0.08]">
          <Row>
            <span className="text-diff-removed">−</span> useState(0)
          </Row>
        </div>
        <Row dim>WelcomeIntro.tsx −64</Row>
      </>
    ),
  },
  {
    key: 'status',
    icon: 'terminal',
    name: 'codex',
    meta: 'T-104',
    title: 'Every session, tracked',
    body: 'Statuses show what each terminal is doing. A notification lands the moment one needs you.',
    content: (
      <>
        <Row dim>npm test -- onboarding</Row>
        <Row>
          <span className={GREEN}>PASS</span> 14 tests in 2.1s
        </Row>
        <div className="mt-2 rounded-md border border-bezel bg-ink/[0.06] px-2 py-1.5">
          <Row>Ouijit · T-104 finished</Row>
        </div>
      </>
    ),
  },
];

const N = TILES.length;

function FeatureTile({ tile, lead = false }: { tile: Tile; lead?: boolean }) {
  return (
    <div
      className={`glass-bevel relative h-full flex flex-col rounded-[14px] overflow-hidden border ${
        lead ? 'border-accent/25' : 'border-bezel-panel'
      }`}
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <div className="pane-ledge relative z-[5] shrink-0 h-8 flex items-center gap-2 px-3">
        <Icon name={tile.icon} className="w-3.5 h-3.5 shrink-0 text-ink/50" />
        <span className="min-w-0 truncate text-[12px] text-ink/70">{tile.name}</span>
        {tile.meta && <span className="ml-auto shrink-0 font-mono text-[10px] text-ink/35">{tile.meta}</span>}
      </div>
      <div className="flex-1 min-h-0 p-3 flex flex-col gap-1 font-mono text-[11px] leading-[1.6] overflow-hidden">
        {tile.content}
      </div>
    </div>
  );
}

/* ─── The scrub ───────────────────────────────────────────────────── */

/**
 * A tall wrapper whose sticky child holds the viewport while it passes.
 * Returns t across the whole run, 0 to 1, on every scroll frame.
 */
function useStageScrub() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState(0);
  const last = useRef(-1);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const next = span > 0 ? clamp01(-rect.top / span) : 0;
      const rounded = Math.round(next * 1000);
      if (rounded !== last.current) {
        last.current = rounded;
        setT(next);
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return { wrapRef, t };
}

/** Reduced motion and narrow viewports get the finished grid, unscrubbed. */
function useStaticMode() {
  const [staticMode, setStaticMode] = useState(false);
  useEffect(() => {
    const queries = [window.matchMedia('(max-width: 860px)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
    const update = () => setStaticMode(queries.some((q) => q.matches));
    update();
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return staticMode;
}

/* ─── Layout maths ────────────────────────────────────────────────── */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Columns and rows the fleet sits in at each size, and how much of the
 *  stage that grid is allowed to fill — a lone tile must not span it. */
const SHAPE: Array<{ cols: number; rows: number; w: number; h: number }> = [
  { cols: 1, rows: 1, w: 42, h: 58 },
  { cols: 2, rows: 1, w: 72, h: 52 },
  { cols: 3, rows: 1, w: 96, h: 46 },
  { cols: 2, rows: 2, w: 72, h: 96 },
  { cols: 3, rows: 2, w: 96, h: 96 },
];

/**
 * The seam between tiles, as a share of the stage. It opens from nothing as
 * the fleet grows, so the first split reads as one surface dividing rather
 * than a second tile appearing beside the first.
 */
const seamAt = (size: number) => lerp(0, 2.4, clamp01((size - 1) / 2));

function layoutFor(size: number): Rect[] {
  const { cols, rows, w: fw, h: fh } = SHAPE[Math.min(size, N) - 1];
  const gap = seamAt(size);
  const cw = (fw - gap * (cols - 1)) / cols;
  const ch = (fh - gap * (rows - 1)) / rows;
  const ox = (100 - fw) / 2;
  const oy = (100 - fh) / 2;
  return TILES.map((_, i) => {
    const slot = Math.min(i, cols * rows - 1);
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    return { x: ox + col * (cw + gap), y: oy + row * (ch + gap), w: cw, h: ch };
  });
}

const LAYOUTS = Array.from({ length: N }, (_, i) => layoutFor(i + 1));

function blend(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

/** Where every tile sits at a fractional fleet size, and how present it is.
 *  An unborn tile rides its parent's rectangle, so it splits off rather than
 *  fading in over empty stage. */
function frameAt(pos: number) {
  const lo = Math.min(Math.floor(pos), N - 1);
  const hi = Math.min(lo + 1, N - 1);
  const f = easeInOut(clamp01(pos - lo));
  return TILES.map((_, i) => {
    const born = clamp01((pos - (i - 0.85)) / 0.85);
    const rect = blend(LAYOUTS[lo][i], LAYOUTS[hi][i], f);
    const parent = blend(LAYOUTS[lo][Math.max(0, i - 1)], LAYOUTS[hi][Math.max(0, i - 1)], f);
    return { rect: born >= 1 ? rect : blend(parent, rect, born), born };
  });
}

/* ─── Captions ────────────────────────────────────────────────────── */

/** One caption at a time, crossfaded — no five-column row to squeeze. */
function StageCaption({ pos, align = 'left' }: { pos: number; align?: 'left' | 'center' }) {
  return (
    <div className={`fleet-caption ${align === 'center' ? 'fleet-caption--center' : ''}`}>
      {TILES.map((tile, i) => {
        const near = 1 - clamp01(Math.abs(pos - i) / 0.8);
        if (near <= 0) return null;
        return (
          <div key={tile.key} className="fleet-caption-item" style={{ opacity: near }}>
            <h3>{tile.title}</h3>
            <p>{tile.body}</p>
          </div>
        );
      })}
    </div>
  );
}

function ProgressRail({ pos }: { pos: number }) {
  return (
    <div className="fleet-rail" aria-hidden>
      {TILES.map((tile, i) => (
        <span key={tile.key} className={pos >= i - 0.3 ? 'is-on' : undefined} />
      ))}
    </div>
  );
}

/** The scroll length the stage consumes. Static mode collapses it: with no
 *  sticky child to hold, that height would be empty scrolling. */
function Stage({
  wrapRef,
  staticMode,
  children,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  staticMode: boolean;
  children: ReactNode;
}) {
  return (
    <div ref={wrapRef} style={{ height: staticMode ? 'auto' : `${N * 90}vh` }}>
      <div className="fleet-sticky">{children}</div>
    </div>
  );
}

/* ═══ 7a · Mitosis — one surface divides, the seams open as it grows ═══ */

export function VariantMitosis() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const pos = staticMode ? N - 1 : t * (N - 1);
  const frame = frameAt(pos);
  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode}>
      <div className="fleet-field">
        {TILES.map((tile, i) => {
          const { rect, born } = frame[i];
          return (
            <div
              key={tile.key}
              style={{
                position: 'absolute',
                left: `${rect.x}%`,
                top: `${rect.y}%`,
                width: `${rect.w}%`,
                height: `${rect.h}%`,
                opacity: born,
                zIndex: N - i,
              }}
            >
              <FeatureTile tile={tile} lead={i === 0} />
            </div>
          );
        })}
      </div>
      <StageCaption pos={pos} />
      <ProgressRail pos={pos} />
    </Stage>
  );
}

/* ═══ 7b · Dock — the fleet flies in from off stage and locks to the grid ═══ */

/** Where each tile waits before it docks, as a shove off its resting place. */
const ENTRY: Array<[number, number]> = [
  [0, 0],
  [120, -30],
  [120, 40],
  [-120, 60],
  [0, 130],
];

export function VariantDock() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const pos = staticMode ? N - 1 : t * (N - 1);
  const final = LAYOUTS[N - 1];
  const lead = LAYOUTS[0][0];
  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode}>
      <div className="fleet-field">
        {TILES.map((tile, i) => {
          const arrive = easeInOut(clamp01(pos - (i - 1)));
          // The lead tile starts alone and centred, then settles into slot one.
          const rest = i === 0 ? blend(lead, final[0], easeInOut(clamp01(pos))) : final[i];
          const [dx, dy] = ENTRY[i];
          return (
            <div
              key={tile.key}
              style={{
                position: 'absolute',
                left: `${rest.x}%`,
                top: `${rest.y}%`,
                width: `${rest.w}%`,
                height: `${rest.h}%`,
                transform: `translate(${lerp(dx, 0, arrive)}%, ${lerp(dy, 0, arrive)}%)`,
                opacity: i === 0 ? 1 : clamp01(arrive * 2.2),
                zIndex: N - i,
              }}
            >
              <FeatureTile tile={tile} lead={i === 0} />
            </div>
          );
        })}
      </div>
      <StageCaption pos={pos} />
      <ProgressRail pos={pos} />
    </Stage>
  );
}

/* ═══ 7c · Wall — the camera retreats until the whole fleet is in frame ═══ */

const WALL_COLS = 3;
const WALL_ROWS = 3;
const WALL = Array.from({ length: WALL_COLS * WALL_ROWS }, (_, i) => TILES[i % N]);

export function VariantWall() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const pos = staticMode ? N - 1 : t * (N - 1);
  const e = easeInOut(pos / (N - 1));
  const scale = lerp(2.9, 0.94, e);
  /*
   * Scaling about the lead tile's own centre pins that point where it already
   * sat — the field's top-left ninth — so the tile leaves frame on the way
   * out. Origin 0 0 instead, and place the grid by hand: hold the lead tile
   * in the middle while zoomed in, then hand over to the centred wall.
   */
  const offset = 100 * lerp(0.5 - scale / (WALL_COLS * 2), (1 - scale) / 2, e);
  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode}>
      <div className="fleet-field fleet-field--wall">
        <div
          className="fleet-wall"
          style={{
            gridTemplateColumns: `repeat(${WALL_COLS}, 1fr)`,
            gridTemplateRows: `repeat(${WALL_ROWS}, 1fr)`,
            transform: `translate(${offset}%, ${offset}%) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {WALL.map((tile, i) => (
            <div key={i} style={{ opacity: i === 0 ? 1 : clamp01((e - 0.05) / 0.4) * (i < N ? 1 : 0.5) }}>
              <FeatureTile tile={tile} lead={i === 0} />
            </div>
          ))}
        </div>
      </div>
      <StageCaption pos={pos} align="center" />
      <ProgressRail pos={pos} />
    </Stage>
  );
}
