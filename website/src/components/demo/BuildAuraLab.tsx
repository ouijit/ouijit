import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Build section lab, round 9 — parallelism carried by the desk washes rather
 * than by repeated chrome. Colour is a state on this site (the Plan section
 * drains a desk as a card leaves and charges the column as it lands), so
 * these make the wash the mechanism instead of the backdrop.
 *
 * All four pin the viewport and scrub with the wheel.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** The prism sweep, split back into the stops the wash is built from, so a
 *  per-task colour is the same colour that desk would have shown. */
const PRISM = [
  'oklch(80% 0.13 295)',
  'oklch(79% 0.13 330)',
  'oklch(78% 0.14 15)',
  'oklch(84% 0.13 80)',
  'oklch(86% 0.14 130)',
];

const TASKS = [
  { task: 'T-101', name: 'rework-onboarding' },
  { task: 'T-102', name: 'billing-retries' },
  { task: 'T-103', name: 'invitation-email' },
  { task: 'T-104', name: 'search-index' },
  { task: 'T-105', name: 'invoices-csv' },
];

const N = TASKS.length;

/* ─── Stage plumbing ──────────────────────────────────────────────── */

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

function StageCaption({ captions, pos }: { captions: Caption[]; pos: number }) {
  return (
    <div className="aura-caption">
      {captions.map((c, i) => {
        const near = 1 - clamp01(Math.abs(pos - i) / 0.8);
        if (near <= 0) return null;
        return (
          <div key={c.title} className="aura-caption-item" style={{ opacity: near }}>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        );
      })}
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
      <div className="aura-sticky">{children}</div>
    </div>
  );
}

/* ═══ 9a · Prism — one prompt refracted into five branches ═══ */

const PRISM_CAPTIONS: Caption[] = [
  { title: 'One instruction', body: 'Describe the work once, the way you would to a person who is about to go and do it.' },
  { title: 'Split into tasks', body: 'Hand it to an agent and it files each piece on the board over the CLI, prompt included.' },
  { title: 'Each takes a branch', body: 'Every task gets its own git worktree, so five agents edit five checkouts and never collide.' },
  { title: 'All of them at once', body: 'Nothing is queued behind anything else. They start together and finish when they finish.' },
  { title: 'Five branches, one afternoon', body: 'You review diffs instead of writing them, and merge the ones that are right.' },
];

const PW = 1240;
const PH = 560;
const APEX = { x: 430, y: PH / 2 };
const RAY_END = 1010;
const FAN = 92;

export function VariantPrism() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const pos = staticMode ? N - 1 : t * (N - 1);
  const beam = staticMode ? 1 : easeOut(clamp01(pos / 0.75));

  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={N}>
      <div className="aura-field">
        <svg className="aura-svg" viewBox={`0 0 ${PW} ${PH}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
          <defs>
            <linearGradient id="pz-beam" x1="0" x2="1">
              <stop offset="0" stopColor="oklch(46% 0.013 285)" stopOpacity="0" />
              <stop offset="1" stopColor="oklch(88% 0.008 285)" />
            </linearGradient>
            <filter id="pz-glow" x="-30%" y="-120%" width="160%" height="340%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>

          {/* The incoming beam: graphite, the one colourless thing on the stage. */}
          <g opacity={beam}>
            <line x1={40} y1={APEX.y} x2={APEX.x} y2={APEX.y} stroke="url(#pz-beam)" strokeWidth={9} filter="url(#pz-glow)" opacity={0.5} />
            <line x1={40} y1={APEX.y} x2={APEX.x} y2={APEX.y} stroke="url(#pz-beam)" strokeWidth={1.5} />
          </g>

          {/* The prism itself, drawn faintly — it is a hinge, not an object. */}
          <path
            d={`M ${APEX.x - 34} ${APEX.y + 46} L ${APEX.x + 8} ${APEX.y - 50} L ${APEX.x + 42} ${APEX.y + 46} Z`}
            fill="none"
            stroke="oklch(72% 0.01 285)"
            strokeWidth={1}
            opacity={beam * 0.32}
            strokeLinejoin="round"
          />

          {TASKS.map((task, i) => {
            const ray = staticMode ? 1 : easeOut(clamp01((pos - i * 0.62) / 1.1));
            if (ray <= 0) return null;
            const y = APEX.y + (i - (N - 1) / 2) * FAN;
            const x = lerp(APEX.x, RAY_END, ray);
            const yNow = lerp(APEX.y, y, ray);
            return (
              <g key={task.task}>
                <line
                  x1={APEX.x}
                  y1={APEX.y}
                  x2={x}
                  y2={yNow}
                  stroke={PRISM[i]}
                  strokeWidth={10}
                  opacity={0.34 * ray}
                  filter="url(#pz-glow)"
                />
                <line x1={APEX.x} y1={APEX.y} x2={x} y2={yNow} stroke={PRISM[i]} strokeWidth={1.6} opacity={0.95} />
                <circle cx={x} cy={yNow} r={3} fill={PRISM[i]} opacity={ray} />
              </g>
            );
          })}
        </svg>

        <div className="pz-labels">
          {TASKS.map((task, i) => {
            const ray = staticMode ? 1 : easeOut(clamp01((pos - i * 0.62) / 1.1));
            const y = 50 + ((i - (N - 1) / 2) * FAN * 100) / PH;
            return (
              <div
                key={task.task}
                className="pz-label"
                style={{ top: `${y}%`, opacity: clamp01((ray - 0.72) / 0.28), color: PRISM[i] }}
              >
                <span className="pz-task">{task.task}</span>
                <span className="pz-name">{task.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      <StageCaption captions={PRISM_CAPTIONS} pos={pos} />
    </Stage>
  );
}

/* ═══ 9b · Lanes — the Plan section's charge, five at a time ═══ */

const LANE_CAPTIONS: Caption[] = [
  { title: 'One lane opens', body: 'A task starts, and its worktree and terminal come up with the agent already running inside.' },
  { title: 'Then another', body: 'Starting a second costs nothing. It gets its own checkout and its own session.' },
  { title: 'They fill together', body: 'Every lane advances at once. None of them is waiting for a turn.' },
  { title: 'At their own pace', body: 'A one-file fix lands while a refactor is still going. You are not blocked on the slowest.' },
  { title: 'Five lanes, one afternoon', body: 'The work you can start is limited by the tasks you can describe, not by your attention.' },
];

/** Where each lane gets to, and how fast — a refactor and a one-line fix
 *  should not advance in step. */
const LANE_RATE = [0.86, 1.24, 0.62, 1.05, 0.78];

export function VariantLanes() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const pos = staticMode ? N - 1 : t * (N - 1);

  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={N}>
      <div className="aura-field aura-field--lanes">
        {TASKS.map((task, i) => {
          const open = staticMode ? 1 : clamp01((pos - i * 0.62) / 0.5);
          const fill = staticMode ? 1 : clamp01(((pos - i * 0.62) / (N - 1)) * LANE_RATE[i] * 1.5);
          return (
            <div key={task.task} className="ln-lane" style={{ opacity: open }}>
              <div className="ln-label">
                <span className="ln-task">{task.task}</span>
                <span className="ln-name">{task.name}</span>
              </div>
              <div className="ln-well">
                <span
                  className="ln-fill"
                  style={{ width: `${fill * 100}%`, backgroundImage: `linear-gradient(90deg, var(--wash-iris))` }}
                />
                <span className="ln-edge" style={{ left: `${fill * 100}%`, background: PRISM[i], opacity: fill > 0.02 && fill < 0.995 ? 1 : 0 }} />
              </div>
              <span className="ln-pct">{Math.round(fill * 100)}%</span>
            </div>
          );
        })}
      </div>
      <StageCaption captions={LANE_CAPTIONS} pos={pos} />
    </Stage>
  );
}

/* ═══ 9c · Flood — the field lights up as agents start ═══ */

const FLOOD_CAPTIONS: Caption[] = [
  { title: 'Nothing running', body: 'A board full of tasks and no one on them. This is every repository on a Monday morning.' },
  { title: 'One agent starts', body: 'The start hook opens a worktree and a terminal, and hands your agent the task’s prompt.' },
  { title: 'Then three', body: 'Each on its own branch. Starting the next one does not slow the last one down.' },
  { title: 'Then all of them', body: 'The limit is how many tasks you can describe, not how many terminals you can watch.' },
  { title: 'The whole board, live', body: 'Five branches moving at once, and a notification the moment one needs you.' },
];

export function VariantFlood() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const pos = staticMode ? N - 1 : t * (N - 1);
  const front = staticMode ? 1 : easeInOut(clamp01(pos / (N - 1)));

  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={N}>
      <div className="aura-field aura-field--flood">
        <div className="fl-plate desk-wash desk-wash--graphite">
          <div className="desk-wash-field" aria-hidden>
            <span className="desk-wash-grain" />
          </div>

          {/* The live half, revealed by width rather than opacity so the
              boundary stays a hard edge the eye can follow. */}
          <div className="fl-live" style={{ width: `${front * 100}%` }} aria-hidden>
            <div className="fl-live-inner" style={{ width: `${(1 / Math.max(front, 0.001)) * 100}%` }}>
              <span className="desk-wash-grain" />
            </div>
          </div>
          <div className="fl-edge" style={{ left: `${front * 100}%`, opacity: front > 0.01 && front < 0.99 ? 1 : 0 }} aria-hidden />

          <div className="fl-names">
            {TASKS.map((task, i) => {
              const lit = front > (i + 0.5) / N;
              return (
                <div key={task.task} className={`fl-name ${lit ? 'is-lit' : ''}`}>
                  <span className="fl-dot" />
                  <span className="fl-task">{task.task}</span>
                  <span className="fl-branch">{task.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <StageCaption captions={FLOOD_CAPTIONS} pos={pos} />
    </Stage>
  );
}

/* ═══ 9d · Fission — one node splits, with the trails it left ═══ */

const FISSION_CAPTIONS: Caption[] = [
  { title: 'One session', body: 'A task, a worktree, an agent. Everything the product does starts here.' },
  { title: 'It divides', body: 'Break the work into tasks and each one leaves with its own branch and its own terminal.' },
  { title: 'And again', body: 'Nothing is copied and nothing is shared. Every split is a real checkout on disk.' },
  { title: 'Until the board is full', body: 'Five agents working at once, none of them able to step on another’s files.' },
  { title: 'Then they come back', body: 'Each moves itself to review over the CLI, and you read five diffs instead of writing five branches.' },
];

const FW = 1240;
const FH = 520;
const ORIGIN = { x: FW / 2, y: 132 };
const REST_Y = 404;

export function VariantFission() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const pos = staticMode ? N - 1 : t * (N - 1);

  return (
    <Stage wrapRef={wrapRef} staticMode={staticMode} steps={N}>
      <div className="aura-field">
        <svg className="aura-svg" viewBox={`0 0 ${FW} ${FH}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
          <defs>
            <filter id="fz-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="9" />
            </filter>
            {PRISM.map((hue, i) => (
              <linearGradient key={i} id={`fz-trail-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={hue} stopOpacity="0" />
                <stop offset="1" stopColor={hue} stopOpacity="0.75" />
              </linearGradient>
            ))}
          </defs>

          <circle cx={ORIGIN.x} cy={ORIGIN.y} r={26} fill="oklch(88% 0.008 285)" opacity={0.13} filter="url(#fz-glow)" />
          <circle cx={ORIGIN.x} cy={ORIGIN.y} r={4.5} fill="oklch(94% 0.006 285)" opacity={0.9} />

          {TASKS.map((task, i) => {
            const go = staticMode ? 1 : easeOut(clamp01((pos - i * 0.72) / 1.05));
            if (go <= 0) return null;
            const x = ORIGIN.x + (i - (N - 1) / 2) * 214;
            const cx = lerp(ORIGIN.x, x, easeInOut(go));
            const cy = lerp(ORIGIN.y, REST_Y, go);
            return (
              <g key={task.task}>
                <path
                  d={`M ${ORIGIN.x} ${ORIGIN.y} Q ${ORIGIN.x} ${(ORIGIN.y + cy) / 2} ${cx} ${cy}`}
                  fill="none"
                  stroke={`url(#fz-trail-${i})`}
                  strokeWidth={1.4}
                  opacity={0.85}
                />
                <circle cx={cx} cy={cy} r={22} fill={PRISM[i]} opacity={0.2 * go} filter="url(#fz-glow)" />
                <circle cx={cx} cy={cy} r={5} fill={PRISM[i]} />
              </g>
            );
          })}
        </svg>

        <div className="fz-labels">
          {TASKS.map((task, i) => {
            const go = staticMode ? 1 : easeOut(clamp01((pos - i * 0.72) / 1.05));
            return (
              <div
                key={task.task}
                className="fz-label"
                style={{
                  left: `${50 + ((i - (N - 1) / 2) * 214 * 100) / FW}%`,
                  opacity: clamp01((go - 0.8) / 0.2),
                  color: PRISM[i],
                }}
              >
                <span className="fz-task">{task.task}</span>
                <span className="fz-name">{task.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      <StageCaption captions={FISSION_CAPTIONS} pos={pos} />
    </Stage>
  );
}
