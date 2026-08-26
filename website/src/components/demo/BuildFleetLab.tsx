import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';

/**
 * Build section lab — parallelism without multiplying the mock interface.
 * Repeated chrome reads as clip art, so these show the work rather than the
 * window: when sessions overlap, how many are running, and what they emit.
 *
 * All four pin the viewport and scrub with the wheel.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/* ─── The scrub ───────────────────────────────────────────────────── */

/** A tall wrapper whose sticky child holds the viewport while it passes. */
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

/** Reduced motion and narrow viewports get the finished state, unscrubbed. */
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

interface Caption {
  title: string;
  body: string;
}

/** One caption at a time, crossfaded — no column row to squeeze at any width. */
function StageCaption({
  captions,
  pos,
  align = 'left',
}: {
  captions: Caption[];
  pos: number;
  align?: 'left' | 'center';
}) {
  return (
    <div className={`fleet-caption ${align === 'center' ? 'fleet-caption--center' : ''}`}>
      {captions.map((c, i) => {
        const near = 1 - clamp01(Math.abs(pos - i) / 0.8);
        if (near <= 0) return null;
        return (
          <div key={c.title} className="fleet-caption-item" style={{ opacity: near }}>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        );
      })}
    </div>
  );
}

function ProgressRail({ count, pos }: { count: number; pos: number }) {
  return (
    <div className="fleet-rail" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={pos >= i - 0.3 ? 'is-on' : undefined} />
      ))}
    </div>
  );
}

function Stage({
  wrapRef,
  staticMode,
  steps,
  children,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  staticMode: boolean;
  steps: number;
  children: ReactNode;
}) {
  return (
    <div ref={wrapRef} style={{ height: staticMode ? 'auto' : `${steps * 70}vh` }}>
      <div className="fleet-sticky">{children}</div>
    </div>
  );
}

/* ═══ 8a · Timeline — when the sessions actually overlap ═══ */

/**
 * Fractions of the track, not minutes: `work` is the agent running, `wait` is
 * the branch sitting in review waiting for a person. The lanes overlap, which
 * is the whole claim the section makes.
 */
const RUNS = [
  { task: 'T-101', name: 'rework-onboarding', start: 0.0, work: 0.54, wait: 0.13 },
  { task: 'T-104', name: 'search-index', start: 0.03, work: 0.79, wait: 0.09 },
  { task: 'T-102', name: 'billing-retries', start: 0.08, work: 0.66, wait: 0.11 },
  { task: 'T-105', name: 'invoices-csv', start: 0.19, work: 0.44, wait: 0.14 },
  { task: 'T-103', name: 'invitation-email', start: 0.31, work: 0.31, wait: 0.07 },
];

const TICKS = ['0', '5 min', '10 min', '15 min'];

const TIMELINE_CAPTIONS: Caption[] = [
  {
    title: 'One task starts',
    body: 'It gets its own git worktree and terminal, and the start hook launches your agent inside it.',
  },
  {
    title: 'The next does not wait',
    body: 'Nothing queues behind anything. A second task starts in its own worktree while the first is still running.',
  },
  {
    title: 'They overlap',
    body: 'Agent time stacks in parallel. The number that matters is the one across the bottom, not the sum of the rows.',
  },
  {
    title: 'You are the bottleneck, briefly',
    body: 'The lighter tail on each lane is the branch waiting on you — read the diff, send notes, move it on.',
  },
  {
    title: 'Two hours of agent, twenty minutes of yours',
    body: 'Five branches land in about the time one of them would have taken alone.',
  },
];

function TimelineLane({ run, draw }: { run: (typeof RUNS)[number]; draw: number }) {
  const waitStart = run.start + run.work;
  const wait = run.wait * clamp01((draw - 0.86) / 0.14);
  return (
    <div className="tl-lane" style={{ opacity: draw > 0 ? 1 : 0 }}>
      <div className="tl-label">
        <span className="tl-task">{run.task}</span>
        <span className="tl-name">{run.name}</span>
      </div>
      <div className="tl-track">
        <span
          className="tl-bar tl-bar--work"
          style={{ left: `${run.start * 100}%`, width: `${run.work * draw * 100}%` }}
        />
        {wait > 0 && (
          <span className="tl-bar tl-bar--wait" style={{ left: `${waitStart * 100}%`, width: `${wait * 100}%` }} />
        )}
        {draw >= 1 && (
          <span className="tl-done" style={{ left: `${(waitStart + run.wait) * 100}%` }}>
            <Icon name="check" />
          </span>
        )}
      </div>
    </div>
  );
}

export function VariantTimeline() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const steps = RUNS.length;
  const pos = staticMode ? steps - 1 : t * (steps - 1);
  const summary = staticMode ? 1 : clamp01((pos - (steps - 1.6)) / 0.6);

  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={steps}>
      <div className="fleet-field fleet-field--flat">
        <div className="tl-chart">
          {RUNS.map((run, i) => (
            <TimelineLane key={run.task} run={run} draw={staticMode ? 1 : clamp01((pos - i * 0.75) / 0.85)} />
          ))}

          <div className="tl-axis" aria-hidden>
            {TICKS.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>

          <div className="tl-summary" style={{ opacity: summary }}>
            <div>
              <strong>17 min</strong>
              <span>wall clock</span>
            </div>
            <div>
              <strong>2h 12m</strong>
              <span>agent time</span>
            </div>
            <div>
              <strong>5</strong>
              <span>branches landed</span>
            </div>
          </div>
        </div>
      </div>
      <StageCaption captions={TIMELINE_CAPTIONS} pos={pos} />
      <ProgressRail count={steps} pos={pos} />
    </Stage>
  );
}

/* ═══ 8c · Fleet — the app's own status colours, at scale ═══ */

type PipState = 'busy' | 'wait' | 'done';

const PIP_LABEL: Record<PipState, string> = { busy: 'working', wait: 'needs you', done: 'done' };

/** Deterministic, so the grid does not reshuffle on every scroll frame. */
function pipState(i: number): PipState {
  const n = (i * 2654435761) % 100;
  if (n < 56) return 'busy';
  if (n < 74) return 'wait';
  return 'done';
}

const FLEET_STEPS = [1, 6, 20, 48, 96];

const FLEET_SESSIONS = [
  { task: 'T-101', prompt: 'Split onboarding into a stepper.', tool: 'Read(Stepper.tsx)', stat: '+92 / −14' },
  { task: 'T-102', prompt: 'Wire payment retries to the dunning queue.', tool: 'Edit(webhookRouter.ts)', stat: '+61 / −8' },
  { task: 'T-103', prompt: 'Polish the invitation email.', tool: 'Write(invitation.tsx)', stat: '+34 / −2' },
  { task: 'T-104', prompt: 'Speed up the search index build.', tool: 'Bash(npm test)', stat: '+118 / −40' },
  { task: 'T-105', prompt: 'Add CSV export to the invoices table.', tool: 'Edit(InvoicesTable.tsx)', stat: '+47 / −6' },
];

const FLEET_CAPTIONS: Caption[] = [
  {
    title: 'One session',
    body: 'A task, its worktree, and an agent working in it. The dot is the status the app already shows you.',
  },
  {
    title: 'Then a handful',
    body: 'Start as many as you have tasks. Each is isolated on its own branch, so they cannot collide.',
  },
  {
    title: 'Then more than you can watch',
    body: 'You stop reading terminals and start reading status: working, needs you, done.',
  },
  {
    title: 'The ones that need you stand out',
    body: 'Only the amber sessions are waiting on a person. Everything else is still moving without you.',
  },
  {
    title: 'Any one of them, in full',
    body: 'Point at a session to bring up its terminal — the same card the app gives you.',
  },
];

function FleetCard({ index }: { index: number }) {
  const s = FLEET_SESSIONS[index % FLEET_SESSIONS.length];
  const state = pipState(index);
  return (
    <div className="fleet-card glass-bevel">
      <div className="pane-ledge relative z-[5] shrink-0 h-8 flex items-center gap-2 px-3">
        <Icon name="terminal" className="w-3.5 h-3.5 shrink-0 text-ink/50" />
        <span className="min-w-0 truncate text-[12px] text-ink/70">claude</span>
        <span className={`fleet-pip fleet-pip--${state} is-on fleet-pip--inline`} />
        <span className="ml-auto shrink-0 font-mono text-[10px] text-ink/35">{s.task}</span>
      </div>
      <div className="flex-1 min-h-0 p-3 flex flex-col gap-1 font-mono text-[11px] leading-[1.6] overflow-hidden">
        <div className="truncate text-ink/35">$ claude &quot;$OUIJIT_TASK_DESCRIPTION&quot;</div>
        <div className="truncate text-ink/70">› {s.prompt}</div>
        <div className="truncate text-ink/35">{s.tool}</div>
        <div className="truncate text-ansi-green">{s.stat}</div>
        <div className="mt-auto text-[10px] text-ink/40">{PIP_LABEL[state]}</div>
      </div>
    </div>
  );
}

export function VariantFleet() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const [hover, setHover] = useState<number | null>(null);
  const steps = FLEET_STEPS.length;
  const pos = staticMode ? steps - 1 : t * (steps - 1);

  const lo = Math.min(Math.floor(pos), steps - 1);
  const hi = Math.min(lo + 1, steps - 1);
  const count = Math.round(lerp(FLEET_STEPS[lo], FLEET_STEPS[hi], easeInOut(clamp01(pos - lo))));
  const selected = hover ?? 0;

  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={steps}>
      <div className="fleet-field fleet-field--split">
        <div className="fleet-pips" onMouseLeave={() => setHover(null)}>
          {Array.from({ length: FLEET_STEPS[steps - 1] }, (_, i) => {
            const on = i < count;
            return (
              <span
                key={i}
                className={`fleet-pip fleet-pip--${pipState(i)} ${on ? 'is-on' : ''} ${
                  selected === i && on ? 'is-picked' : ''
                }`}
                onMouseEnter={() => on && setHover(i)}
              />
            );
          })}
        </div>
        <div className="fleet-side">
          <div className="fleet-count">
            <strong>{count}</strong>
            <span>{count === 1 ? 'session' : 'sessions'}</span>
          </div>
          <FleetCard index={selected} />
        </div>
      </div>
      <StageCaption captions={FLEET_CAPTIONS} pos={pos} />
      <ProgressRail count={steps} pos={pos} />
    </Stage>
  );
}

/* ═══ 8d · Streams — one terminal, every session's output through it ═══ */

/** Task index, then the line. Ordered so later entries interleave more tasks. */
const STREAM: Array<[number, string]> = [
  [0, 'claude "$OUIJIT_TASK_DESCRIPTION"'],
  [0, 'Read(src/onboarding/Stepper.tsx) → 142 lines'],
  [0, 'Write(plan.md) → +24 lines'],
  [1, 'claude "$OUIJIT_TASK_DESCRIPTION"'],
  [0, 'Edit(src/onboarding/Stepper.tsx) → +92 / −14'],
  [1, 'Read(src/billing/webhookRouter.ts) → 612 lines'],
  [2, 'claude "$OUIJIT_TASK_DESCRIPTION"'],
  [1, 'Edit(src/billing/dunningQueue.ts) → +18 / −4'],
  [0, 'Bash(npm test -- onboarding) → PASS 14 tests'],
  [2, 'Write(app/mailers/templates/invitation.tsx) → +34'],
  [3, 'claude "$OUIJIT_TASK_DESCRIPTION"'],
  [1, 'Edit(src/billing/webhookRouter.ts) → +61 / −8'],
  [3, 'Read(src/search/indexBuilder.ts) → 388 lines'],
  [2, 'Bash(npm run build:mail) → ok in 3.4s'],
  [4, 'claude "$OUIJIT_TASK_DESCRIPTION"'],
  [3, 'Edit(src/search/tokenizer.ts) → +40 / −12'],
  [0, 'task 101 → in_review'],
  [4, 'Read(src/invoices/InvoicesTable.tsx) → 431 lines'],
  [3, 'Bash(npm test -- search) → PASS 31 tests'],
  [1, 'Bash(npm test -- billing) → PASS 22 tests'],
  [4, 'Edit(src/invoices/InvoicesTable.tsx) → +47 / −6'],
  [2, 'task 103 → in_review'],
  [3, 'Edit(src/search/indexBuilder.ts) → +78 / −28'],
  [4, 'Write(src/invoices/toCsv.ts) → +64 lines'],
  [1, 'task 102 → in_review'],
  [3, 'Bash(npm run bench:index) → 2.1× faster'],
  [4, 'Bash(npm test -- invoices) → PASS 9 tests'],
  [3, 'task 104 → in_review'],
  [4, 'task 105 → in_review'],
];

const STREAM_TASKS = ['T-101', 'T-102', 'T-103', 'T-104', 'T-105'];
const VISIBLE_LINES = 16;

const STREAM_CAPTIONS: Caption[] = [
  { title: 'One session, talking', body: 'An agent reads, plans, and edits inside the worktree its task owns.' },
  {
    title: 'A second joins',
    body: 'Every line stays tagged with the task it came from, so two streams never blur into one.',
  },
  { title: 'Then the rest', body: 'Five agents on five branches, none of them waiting for another to finish.' },
  {
    title: 'Results come back out of order',
    body: 'They finish when they finish. The board keeps the order, not the output.',
  },
  { title: 'And they land themselves', body: 'Each moves itself to review over the CLI the moment its work is done.' },
];

export function VariantStreams() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const steps = STREAM_CAPTIONS.length;
  const pos = staticMode ? steps - 1 : t * (steps - 1);

  const shown = staticMode ? STREAM.length : Math.round(clamp01(t * 1.04) * STREAM.length);
  const lines = STREAM.slice(Math.max(0, shown - VISIBLE_LINES), shown);
  const seen = STREAM.slice(0, shown);
  const active = new Set(seen.map(([task]) => task)).size;

  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={steps}>
      <div className="fleet-field fleet-field--flat">
        <div className="st-shell glass-bevel">
          <div className="pane-ledge relative z-[5] shrink-0 h-10 flex items-center gap-3 px-4">
            <Icon name="cards-three" className="w-4 h-4 shrink-0 text-ink/50" />
            <span className="text-[13px] text-ink/70">All sessions</span>
            <span className="ml-auto flex items-center gap-3">
              {STREAM_TASKS.map((task, i) => (
                <span key={task} className={`st-chip ${seen.some(([n]) => n === i) ? 'is-on' : ''}`}>
                  <span className="st-swatch" style={{ background: `var(--st-${i})` }} />
                  {task}
                </span>
              ))}
            </span>
          </div>
          <div className="st-log">
            {lines.map(([task, text], i) => (
              <div
                key={shown - lines.length + i}
                className="st-line"
                style={{ ['--st-line' as string]: `var(--st-${task})` }}
              >
                <span className="st-tag">{STREAM_TASKS[task]}</span>
                <span className="st-text">{text}</span>
              </div>
            ))}
          </div>
          <div className="st-foot">
            <span>
              <strong>{active}</strong> {active === 1 ? 'session' : 'sessions'} running
            </span>
            <span>{shown} lines</span>
          </div>
        </div>
      </div>
      <StageCaption captions={STREAM_CAPTIONS} pos={pos} />
      <ProgressRail count={steps} pos={pos} />
    </Stage>
  );
}

/* ═══ 7c · Wall — the camera retreats until the whole fleet is in frame ═══ */

interface Tile {
  key: string;
  icon: string;
  name: string;
  meta?: string;
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
      </>
    ),
  },
  {
    key: 'preview',
    icon: 'globe-simple',
    name: 'localhost:5173',
    content: (
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="h-1.5 w-1/3 rounded-full bg-ink/25" />
        <div className="flex gap-1.5">
          <span className="h-6 flex-1 rounded bg-accent/25" />
          <span className="h-6 flex-1 rounded bg-ink/10" />
          <span className="h-6 flex-1 rounded bg-ink/10" />
        </div>
        <div className="h-1.5 w-2/3 rounded-full bg-ink/12" />
      </div>
    ),
  },
  {
    key: 'diff',
    icon: 'git-branch',
    name: '3 files',
    meta: '+130 −78',
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
      </>
    ),
  },
  {
    key: 'status',
    icon: 'terminal',
    name: 'codex',
    meta: 'T-104',
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

const WALL_CAPTIONS: Caption[] = [
  {
    title: 'One task, one worktree',
    body: 'Every task gets its own git worktree and terminal, launched by the start hook.',
  },
  {
    title: 'The plan, docked',
    body: 'Any markdown file docks to a terminal as a live panel, updating as the agent writes it.',
  },
  {
    title: 'The branch, running',
    body: 'A preview panel points at any URL. Aim one at the dev server and watch this branch run.',
  },
  {
    title: 'The diff, one tab over',
    body: 'Every change on the branch appears as it happens, with your notes on the lines that need them.',
  },
  {
    title: 'Every session, tracked',
    body: 'Statuses show what each terminal is doing. A notification lands the moment one needs you.',
  },
];

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

const WALL_COLS = 3;
const WALL_ROWS = 3;
const WALL = Array.from({ length: WALL_COLS * WALL_ROWS }, (_, i) => TILES[i % TILES.length]);

export function VariantWall() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const steps = TILES.length;
  const pos = staticMode ? steps - 1 : t * (steps - 1);
  const e = easeInOut(pos / (steps - 1));
  const scale = lerp(2.9, 0.94, e);
  /*
   * Scaling about the lead tile's own centre pins that point where it already
   * sat — the field's top-left ninth — so the tile leaves frame on the way
   * out. Origin 0 0 instead, and place the grid by hand: hold the lead tile
   * in the middle while zoomed in, then hand over to the centred wall.
   */
  const offset = 100 * lerp(0.5 - scale / (WALL_COLS * 2), (1 - scale) / 2, e);
  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={steps}>
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
            <div key={i} style={{ opacity: i === 0 ? 1 : clamp01((e - 0.05) / 0.4) * (i < TILES.length ? 1 : 0.5) }}>
              <FeatureTile tile={tile} lead={i === 0} />
            </div>
          ))}
        </div>
      </div>
      <StageCaption captions={WALL_CAPTIONS} pos={pos} align="center" />
      <ProgressRail count={steps} pos={pos} />
    </Stage>
  );
}
