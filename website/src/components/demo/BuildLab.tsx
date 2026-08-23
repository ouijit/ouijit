import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import {
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  Continuation,
  BranchLabel,
  ClaudeShell,
  BODY_CLS,
  DevServerBody,
} from './stackParts';

/**
 * Build section lab, round 1 — four concepts for the Build pillar (worktrees,
 * start hook, statuses, sandbox, the plan panel, the session-aware CLI).
 * All choreography is scroll-scrubbed and reverses on the way back up.
 */

/* ─── Shared fixtures ─────────────────────────────────────────────── */

function task(taskNumber: number, name: string, branch: string, status = 'todo'): TaskWithWorkspace {
  return {
    taskNumber,
    name,
    status,
    branch,
    worktreePath: `/demo/horizon/.ouijit/worktrees/T-${taskNumber}`,
    createdAt: '2026-05-08T09:00:00Z',
  };
}

const T119 = task(119, 'Add rate-limit headers to the public API', 'api-rate-limit-headers');
const T119_REVIEW = task(119, 'Add rate-limit headers to the public API', 'api-rate-limit-headers', 'in_review');
const T116_REVIEW = task(116, 'Bump deps for security advisory', 'bump-deps-advisory', 'in_review');

const DESK_HUES = {
  indigo:
    'radial-gradient(120% 140% at 15% 0%, rgba(99, 102, 241, 0.32), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(56, 189, 248, 0.14), transparent 55%), linear-gradient(180deg, #191a2e, #121218)',
  teal: 'radial-gradient(120% 140% at 85% 0%, rgba(45, 212, 191, 0.22), transparent 60%), radial-gradient(120% 120% at 0% 100%, rgba(99, 102, 241, 0.16), transparent 55%), linear-gradient(180deg, #14201f, #101314)',
  rose: 'radial-gradient(120% 140% at 20% 10%, rgba(233, 103, 159, 0.26), transparent 60%), radial-gradient(120% 130% at 100% 90%, rgba(168, 85, 247, 0.16), transparent 60%), linear-gradient(180deg, #221521, #131015)',
  graphite: 'radial-gradient(120% 140% at 50% 0%, rgba(255, 255, 255, 0.05), transparent 60%), linear-gradient(180deg, #1c1d23, #131318)',
} as const;

function Desk({
  hue,
  className = '',
  style,
  children,
}: {
  hue: keyof typeof DESK_HUES;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`plan-desk ${className}`} style={{ backgroundImage: DESK_HUES[hue], ...style }}>
      {children}
    </div>
  );
}

function Panel({
  firing = false,
  className = '',
  style,
  ledge,
  children,
}: {
  firing?: boolean;
  className?: string;
  style?: React.CSSProperties;
  ledge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel min-h-0 ${
        firing ? 'plan-firing' : ''
      } ${className}`}
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', ...style }}
    >
      {ledge && <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">{ledge}</div>}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/* ─── Scrub plumbing ──────────────────────────────────────────────── */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function useScrubRows<K extends string>(keys: readonly K[]) {
  const rowEls = useRef<Partial<Record<K, HTMLElement | null>>>({});
  const [progress, setProgress] = useState<Record<K, number>>(
    () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>,
  );
  const sig = useRef('');
  const keysRef = useRef(keys);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight;
      const next = {} as Record<K, number>;
      for (const key of keysRef.current) {
        const el = rowEls.current[key];
        if (!el) {
          next[key] = 0;
          continue;
        }
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        next[key] = clamp01((vh * 0.92 - center) / (vh * 0.42));
      }
      const nextSig = keysRef.current.map((k) => Math.round(next[k] * 500)).join(',');
      if (nextSig !== sig.current) {
        sig.current = nextSig;
        setProgress(next);
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

  const setRow = (key: K) => (el: HTMLElement | null) => void (rowEls.current[key] = el);
  return { setRow, progress };
}

/** A body line that fades in as its beat's progress passes `at`. */
function Line({ p, at, children }: { p: number; at: number; children: ReactNode }) {
  const v = clamp01((p - at) / 0.08);
  return <div style={{ opacity: v, transform: `translateY(${(1 - v) * 4}px)` }}>{children}</div>;
}

type HookState = 'idle' | 'running' | 'done' | 'live';

function HookBar({ label, command, state }: { label: string; command: string; state: HookState }) {
  return (
    <div
      className={`glass-bevel relative flex items-center gap-3 rounded-[12px] border border-bezel-panel px-4 h-11 ${
        state === 'running' ? 'plan-firing' : ''
      }`}
      style={{
        background: 'var(--color-terminal-bg)',
        boxShadow: 'var(--shadow-panel)',
        opacity: state === 'idle' ? 0.55 : 1,
        transition: 'opacity 300ms ease',
      }}
    >
      <Icon name="play" className="w-3.5 h-3.5 text-ink/50" />
      <span className="text-[13px] font-medium text-ink/85 shrink-0">{label}</span>
      <span className="font-mono text-[12px] text-ink/50 truncate">{command}</span>
      <span className="ml-auto shrink-0 flex items-center">
        {state === 'running' && (
          <span
            className="block w-3 h-3 rounded-full bg-transparent border-[1.5px] border-white/30 border-t-white/80"
            style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
          />
        )}
        {state === 'done' && <Icon name="check" className="w-3.5 h-3.5 text-status-ready" />}
        {state === 'live' && (
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-white/55">
            <span
              className="block w-[6px] h-[6px] rounded-full bg-status-ready"
              style={{ animation: 'terminal-status-pulse 1.6s ease-in-out infinite' }}
            />
            live
          </span>
        )}
      </span>
    </div>
  );
}

function CardFrame({ t, className = '', style }: { t: TaskWithWorkspace; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`glass-bevel rounded-[10px] overflow-hidden border border-bezel-panel ${className}`}
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', ...style }}
    >
      <KanbanCardView task={t} showBadge={false} />
    </div>
  );
}

/* ═══ 1a · Ignition — the task becomes a terminal ═════════════════ */

const IGNITION_STEPS = [
  { key: 'move', title: 'Drag it to In Progress', body: 'Starting a task is one move on the board. Everything else follows from it.' },
  { key: 'tree', title: 'A worktree of its own', body: 'The task gets an isolated branch and directory. Parallel agents never collide.' },
  { key: 'hook', title: 'The start hook takes over', body: 'Your agent launches in the new worktree with the task’s prompt in hand.' },
] as const;

type IgnitionKey = (typeof IGNITION_STEPS)[number]['key'];

function MiniBoard({ p }: { p: number }) {
  const e = easeInOut(p);
  const moved = e > 0.5;
  return (
    <div
      className="glass-bevel relative rounded-[14px] border border-bezel-panel overflow-hidden"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', height: 128 }}
    >
      <div className="flex h-full">
        {(['To Do', 'In Progress'] as const).map((label, i) => (
          <div key={label} className={`flex-1 min-w-0 px-4 py-3 ${i === 0 ? 'border-r border-ink/[0.06]' : ''}`}>
            <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
              <span>{label}</span>
              <span className="font-mono text-[11px] text-ink/35">{i === 0 ? (moved ? 0 : 1) : moved ? 1 : 0}</span>
            </div>
          </div>
        ))}
      </div>
      {/* Inline position: the vendored `.glass-bevel > *` rule overrides the
          Tailwind `absolute` utility on direct children. */}
      <div
        style={{
          position: 'absolute',
          left: `calc(${lerp(1.5, 51.5, e)}% + 10px)`,
          top: 44,
          width: 'calc(48.5% - 20px)',
          zIndex: 2,
        }}
      >
        <CardFrame t={T119} />
      </div>
    </div>
  );
}

export function VariantIgnition() {
  const { setRow, progress } = useScrubRows(IGNITION_STEPS.map((s) => s.key) as readonly IgnitionKey[]);
  const pMove = progress.move;
  const pTree = progress.tree;
  const pHook = progress.hook;
  const appear = clamp01((pTree - 0.12) / 0.3);
  const hookState: HookState = pHook < 0.12 ? 'idle' : pHook < 0.5 ? 'running' : 'done';
  const summaryType = pHook > 0.6 ? 'thinking' : 'ready';
  return (
    <div className="bl-split">
      <div className="bl-steps">
        {IGNITION_STEPS.map((s) => (
          <div key={s.key} ref={setRow(s.key)} className="bl-step">
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="bl-rail" style={{ width: 620 }}>
        <Desk hue="indigo" style={{ padding: 32 }}>
          <MiniBoard p={pMove} />
          <div style={{ marginTop: 16, opacity: appear }}>
            <HookBar label="Start" command={'claude "$OUIJIT_TASK_DESCRIPTION"'} state={hookState} />
          </div>
          <div style={{ marginTop: 16, opacity: appear, transform: `translateY(${(1 - easeInOut(appear)) * 20}px)` }}>
            <Panel
              ledge={
                <>
                  <StatusDot summaryType={summaryType} />
                  <span className="font-mono text-xs font-medium text-ink/85">claude</span>
                  <span className="ml-auto">
                    <BranchLabel branch="api-rate-limit-headers" />
                  </span>
                </>
              }
            >
              <div className={BODY_CLS} style={{ height: 264 }}>
                <Line p={pTree} at={0.3}>
                  <span className="text-white/40">$</span> git worktree add .ouijit/worktrees/T-119 -b
                  api-rate-limit-headers
                </Line>
                <Line p={pTree} at={0.44}>
                  <span className="text-white/50">Preparing worktree (new branch 'api-rate-limit-headers')</span>
                </Line>
                <Line p={pTree} at={0.52}>
                  <span className="text-white/50">HEAD is now at 4c9a1f2 Merge queue hardening</span>
                </Line>
                <div className="h-3" />
                <Line p={pHook} at={0.3}>
                  <span className="text-white/40">$</span> claude "$OUIJIT_TASK_DESCRIPTION"
                </Line>
                <Line p={pHook} at={0.48}>
                  <ClaudeUser>Add rate-limit headers to the public API — 429 + Retry-After on every public route</ClaudeUser>
                </Line>
                <Line p={pHook} at={0.6}>
                  <AssistantSay>Middleware first, then the router wiring.</AssistantSay>
                </Line>
                <Line p={pHook} at={0.72}>
                  <ToolCall name="Write" args="src/api/middleware/rateLimit.ts" />
                </Line>
                <Line p={pHook} at={0.8}>
                  <ToolResult>
                    <span className="text-[#3fb950]">+64</span>
                    <span className="ml-2 text-white/55">lines (new)</span>
                  </ToolResult>
                </Line>
              </div>
            </Panel>
          </div>
        </Desk>
      </div>
    </div>
  );
}

/* ═══ 1b · Stations — statuses as stations, hooks fire per stop ═══ */

const STATION_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];

const STATION_ROWS = [
  {
    key: 'start',
    title: 'Every move fires a hook',
    body: 'Drop a task into In Progress and the start hook launches your agent.',
    hue: 'indigo' as const,
  },
  {
    key: 'run',
    title: 'Run means run',
    body: 'One button starts the dev server, in the task’s own worktree.',
    hue: 'teal' as const,
  },
  {
    key: 'review',
    title: 'Review is a hook too',
    body: 'Move the task to In Review and the pull request is already up.',
    hue: 'rose' as const,
  },
] as const;

type StationKey = (typeof STATION_ROWS)[number]['key'];

function StationChip({ pos }: { pos: number }) {
  return (
    <div className="relative h-12 mt-4">
      <div className="absolute inset-x-[8%] top-1/2 h-px bg-white/10" />
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute top-1/2 w-1.5 h-1.5 rounded-full"
          style={{
            left: `calc(${12.5 + i * 25}% - 3px)`,
            transform: 'translateY(-50%)',
            background: Math.abs(pos - i) < 0.5 ? 'var(--color-accent)' : 'rgba(255,255,255,0.18)',
            transition: 'background 300ms ease',
          }}
        />
      ))}
      <div
        className="absolute top-1/2"
        style={{ left: `${12.5 + pos * 25}%`, transform: 'translate(-50%, -50%)' }}
      >
        <span
          className="glass-bevel flex items-center gap-2 rounded-full border border-bezel-panel pl-2.5 pr-3 py-1 whitespace-nowrap"
          style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
        >
          <span className="font-mono text-[11px] text-ink/45">T-119</span>
          <span className="text-[12px] text-ink/85">Add rate-limit headers</span>
        </span>
      </div>
    </div>
  );
}

const hookStateAt = (p: number): HookState => (p < 0.35 ? 'idle' : p < 0.62 ? 'running' : 'done');

function stationMock(key: StationKey, p: number) {
  if (key === 'start')
    return (
      <>
        <HookBar label="Start" command={'claude "$OUIJIT_TASK_DESCRIPTION"'} state={hookStateAt(p)} />
        <Panel className="mt-4">
          <div className={BODY_CLS} style={{ height: 190 }}>
            <Line p={p} at={0.62}>
              <ClaudeUser>Add rate-limit headers to the public API — 429 + Retry-After on every public route</ClaudeUser>
            </Line>
            <Line p={p} at={0.72}>
              <AssistantSay>Middleware first, then the router wiring.</AssistantSay>
            </Line>
            <Line p={p} at={0.8}>
              <ToolCall name="Read" args="src/api/router.ts" />
            </Line>
            <Line p={p} at={0.86}>
              <ToolResult>Read 88 lines</ToolResult>
            </Line>
          </div>
        </Panel>
      </>
    );
  if (key === 'run') {
    const state = hookStateAt(p);
    return (
      <>
        <HookBar label="Run" command="npm run dev" state={state === 'done' ? 'live' : state} />
        <Panel className="mt-4" style={{ opacity: p > 0.55 ? 1 : 0.35, transition: 'opacity 400ms ease' }}>
          <div style={{ height: 210, overflow: 'hidden', display: 'flex' }}>
            <DevServerBody />
          </div>
        </Panel>
      </>
    );
  }
  return (
    <>
      <HookBar label="Review" command="gh pr create --fill" state={hookStateAt(p)} />
      <Panel className="mt-4">
        <div className={BODY_CLS} style={{ height: 140 }}>
          <Line p={p} at={0.62}>
            <span className="text-white/40">$</span> gh pr create --fill
          </Line>
          <Line p={p} at={0.74}>
            <span className="text-white/50">Creating pull request for api-rate-limit-headers into main</span>
          </Line>
          <Line p={p} at={0.84}>
            <span className="text-[#79b8ff]">https://github.com/horizon/api/pull/212</span>
          </Line>
        </div>
      </Panel>
    </>
  );
}

export function VariantStations() {
  const { setRow, progress } = useScrubRows(STATION_ROWS.map((r) => r.key) as readonly StationKey[]);
  const pos =
    easeInOut(clamp01(progress.start / 0.5)) + easeInOut(clamp01(progress.review / 0.5));
  return (
    <div>
      <div className="bl-stations-rail">
        <Desk hue="graphite" style={{ padding: '20px 28px 16px' }}>
          <div className="flex">
            {STATION_STATUSES.map((label, i) => (
              <div
                key={label}
                className="flex-1 text-center text-[13px]"
                style={{
                  color: Math.abs(pos - i) < 0.5 ? 'var(--color-ink)' : '#86868b',
                  transition: 'color 300ms ease',
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <StationChip pos={pos} />
        </Desk>
      </div>
      <div className="flex flex-col" style={{ gap: 140, marginTop: 96 }}>
        {STATION_ROWS.map(({ key, title, body, hue }) => (
          <div key={key} ref={setRow(key)} className="plan-v3-row">
            <div className="plan-v3-copy">
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
            <div className="plan-v3-mock">
              <Desk hue={hue} style={{ padding: 32 }}>{stationMock(key, progress[key])}</Desk>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ 1c · Anatomy — one loaded terminal, annotated part by part ══ */

const ANATOMY_STEPS = [
  { key: 'status', title: 'Status at a glance', body: 'Every terminal reports what its agent is doing: thinking, ready, waiting on you.' },
  { key: 'sandbox', title: 'Sandbox the risky ones', body: 'Run a terminal in a Lima VM or under nono. The outlined dot marks it.' },
  { key: 'panel', title: 'The plan stays open', body: 'Any markdown file rides the terminal as a panel. The agent updates it as it works.' },
  { key: 'cli', title: 'The agent hands it back', body: 'The CLI is session-aware — the task moves to In Review from inside the session.' },
] as const;

type AnatomyKey = (typeof ANATOMY_STEPS)[number]['key'];

const RATE_LIMIT_PLAN = (
  <>
    <h1>Add rate-limit headers</h1>
    <p>
      Public routes get <code>429</code> + <code>Retry-After</code>. Limits ride the existing Redis token bucket.
    </p>
    <h2>Steps</h2>
    <ul>
      <li>
        <input type="checkbox" checked readOnly /> Middleware in <code>src/api/middleware/rateLimit.ts</code>
      </li>
      <li>
        <input type="checkbox" checked readOnly /> Wire into the public router
      </li>
      <li>
        <input type="checkbox" readOnly /> Headers on the 2xx path too (<code>X-RateLimit-Remaining</code>)
      </li>
      <li>
        <input type="checkbox" readOnly /> Tests: burst, sustained, per-key
      </li>
    </ul>
  </>
);

function Lit({ on, className = '', children }: { on: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={`bl-lit ${className}`} data-on={on || undefined}>
      {children}
    </span>
  );
}

function AnatomyTabs({ planActive, lit }: { planActive: boolean; lit: boolean }) {
  const base = 'h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium whitespace-nowrap shrink-0';
  const inactive = 'bg-transparent text-text-secondary';
  const active = 'bg-accent text-accent-ink';
  const divider = <div aria-hidden className="w-px h-3 shrink-0 bg-ink/10 self-center" />;
  return (
    <Lit on={lit} className="block rounded-[12px]">
      <div className="flex items-center min-w-0 h-7 bg-background-secondary glass-bevel relative border border-bezel rounded-[12px] overflow-hidden">
        <span className={`${base} ${planActive ? active : inactive}`}>
          <Icon name="file-text" className="w-3.5 h-3.5" />
          <span>plan.md</span>
        </span>
        {divider}
        <span className={`${base} ${inactive}`}>
          <span>2 files</span>
          <span className="text-status-ready">+73</span>
          <span className="text-ansi-red">-1</span>
        </span>
        {divider}
        <span className={`${base} ${inactive} shrink-0 !px-2`}>
          <Icon name="plus" className="w-3.5 h-3.5" />
        </span>
      </div>
    </Lit>
  );
}

export function VariantAnatomy() {
  const { setRow, progress } = useScrubRows(ANATOMY_STEPS.map((s) => s.key) as readonly AnatomyKey[]);
  let active: AnatomyKey | null = null;
  for (const s of ANATOMY_STEPS) if (progress[s.key] > 0.5) active = s.key;
  const panelV =
    clamp01((progress.panel - 0.4) / 0.3) * (1 - clamp01((progress.cli - 0.15) / 0.3));
  const cliDone = progress.cli > 0.6;
  return (
    <div className="bl-split">
      <div className="bl-steps">
        {ANATOMY_STEPS.map((s) => (
          <div key={s.key} ref={setRow(s.key)} className="bl-step">
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="bl-rail" style={{ width: 640 }}>
        <Desk hue="graphite" style={{ padding: 32 }}>
          <div
            className="glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
            style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', height: 520 }}
          >
            <div className="pane-ledge relative z-[5] shrink-0 flex items-start justify-between px-3 py-2 gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Lit on={active === 'sandbox'} className="flex items-center p-1.5 -m-1.5 rounded-full">
                    <StatusDot summaryType={cliDone ? 'ready' : 'thinking'} sandboxed />
                  </Lit>
                  <Lit on={active === 'status'} className="flex items-center gap-2 min-w-0 px-1.5 py-0.5 -my-0.5 -mx-1.5">
                    <span className="font-mono text-xs font-medium text-ink/85 shrink-0">claude · lima</span>
                    <span className="font-mono text-xs text-ink/45 min-w-0 truncate">
                      — {cliDone ? 'done · moved to In Review' : 'Editing rateLimit.ts…'}
                    </span>
                  </Lit>
                </div>
                <BranchLabel branch="api-rate-limit-headers" />
              </div>
              <AnatomyTabs planActive={panelV > 0.05} lit={active === 'panel'} />
            </div>
            <div className="relative flex-1 min-h-0">
              <div className="absolute inset-0 flex flex-col">
                <ClaudeShell busy={!cliDone}>
                <ClaudeUser>Add rate-limit headers to the public API — 429 + Retry-After on every public route</ClaudeUser>
                <AssistantSay>Middleware first, then the router wiring.</AssistantSay>
                <ToolCall name="Write" args="src/api/middleware/rateLimit.ts" />
                <ToolResult>
                  <span className="text-[#3fb950]">+64</span>
                  <span className="ml-2 text-white/55">lines (new)</span>
                </ToolResult>
                <ToolCall name="Edit" args="src/api/router.ts" />
                <ToolResult>
                  <span className="text-[#3fb950]">+9</span>
                  <span className="mx-1 text-white/30">/</span>
                  <span className="text-[#f85149]">−1</span>
                  <span className="ml-2 text-white/55">lines</span>
                </ToolResult>
                <Continuation>limiter on every /api/public route, Retry-After from the bucket</Continuation>
                <ToolCall name="Bash" args="npm test -- rateLimit" />
                <ToolResult>
                  <span className="text-[#3fb950]">PASS</span>
                  <span className="ml-2 text-white/65">6 tests</span>
                  <span className="ml-2 text-white/35">in 0.8s</span>
                </ToolResult>
                <div className="mt-2">
                  <Lit on={active === 'cli'} className="block px-2 py-1 -mx-2">
                    <ToolCall name="Bash" args="ouijit task set-status 119 in_review" />
                    <ToolResult>{'{"success": true, "task": {"status": "in_review"}}'}</ToolResult>
                  </Lit>
                </div>
                </ClaudeShell>
              </div>
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  background: 'var(--color-terminal-bg)',
                  opacity: panelV,
                  transform: `translateY(${(1 - easeInOut(panelV)) * 14}px)`,
                  pointerEvents: 'none',
                }}
              >
                <div className="flex items-center gap-2 px-4 py-1.5">
                  <Icon name="file-text" className="w-3.5 h-3.5 text-ink/50 shrink-0" />
                  <span className="text-[13px] text-ink/50 font-mono">plan.md</span>
                </div>
                <div className="px-6 py-2">
                  <div className="app-markdown plan-markdown">{RATE_LIMIT_PLAN}</div>
                </div>
              </div>
            </div>
          </div>
        </Desk>
      </div>
    </div>
  );
}

/* ═══ 1d · Round trip — the agent moves its own card to review ════ */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function useSceneScrub() {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const srcRef = useRef<HTMLDivElement | null>(null);
  const dstRef = useRef<HTMLDivElement | null>(null);
  const [p, setP] = useState(0);
  const [boxes, setBoxes] = useState<{ src: Box; dst: Box } | null>(null);
  const sig = useRef('');

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight;
      const scene = sceneRef.current;
      if (!scene) return;
      const rect = scene.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const nextP = clamp01((vh * 0.95 - center) / (vh * 0.55));
      let next: { src: Box; dst: Box } | null = null;
      const stage = stageRef.current;
      const so = srcRef.current;
      const dst = dstRef.current;
      if (stage && so && dst) {
        const s = stage.getBoundingClientRect();
        const a = so.getBoundingClientRect();
        const b = dst.getBoundingClientRect();
        next = {
          src: { x: a.left - s.left, y: a.top - s.top, w: a.width, h: a.height },
          dst: { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height },
        };
      }
      const nextSig = JSON.stringify([
        Math.round(nextP * 500),
        next && [Math.round(next.src.x), Math.round(next.src.y), Math.round(next.dst.x), Math.round(next.dst.y), Math.round(next.dst.h)],
      ]);
      if (nextSig !== sig.current) {
        sig.current = nextSig;
        setP(nextP);
        setBoxes(next);
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

  return { sceneRef, stageRef, srcRef, dstRef, p, boxes };
}

export function VariantRoundTrip() {
  const { sceneRef, stageRef, srcRef, dstRef, p, boxes } = useSceneScrub();
  const firing = p > 0.24 && p < 0.48;
  const fp = clamp01((p - 0.42) / 0.45);
  const open = fp > 0.35;
  const landed = fp >= 0.85;
  const ghost = fp > 0 && fp < 1 && boxes;
  const e = easeInOut(fp);
  return (
    <div ref={sceneRef}>
      <div className="bl-trip-copy">
        <h3>The agent hands it back</h3>
        <p>One session-aware CLI call moves the task to In Review. The board follows, live.</p>
      </div>
      <Desk hue="teal" style={{ padding: 36 }}>
        <div ref={stageRef} className="relative flex gap-8 items-stretch">
          <Panel
            firing={firing}
            className="flex-1 min-w-0"
            style={{ minHeight: 320 }}
            ledge={
              <>
                <StatusDot summaryType={landed ? 'ready' : 'thinking'} />
                <span className="font-mono text-xs font-medium text-ink/85">claude</span>
                <span className="ml-auto">
                  <BranchLabel branch="api-rate-limit-headers" />
                </span>
              </>
            }
          >
            <ClaudeShell busy={!landed}>
              <Line p={p} at={0.04}>
                <ToolCall name="Bash" args="npm test -- rateLimit" />
              </Line>
              <Line p={p} at={0.1}>
                <ToolResult>
                  <span className="text-[#3fb950]">PASS</span>
                  <span className="ml-2 text-white/65">6 tests</span>
                  <span className="ml-2 text-white/35">in 0.8s</span>
                </ToolResult>
              </Line>
              <Line p={p} at={0.17}>
                <AssistantSay>Tests pass. Sending it to review.</AssistantSay>
              </Line>
              <Line p={p} at={0.26}>
                <ToolCall name="Bash" args="ouijit task set-status 119 in_review" />
              </Line>
              <Line p={p} at={0.34}>
                <div ref={srcRef}>
                  <ToolResult>{'{"success": true, "task": {"status": "in_review"}}'}</ToolResult>
                </div>
              </Line>
            </ClaudeShell>
          </Panel>
          <div
            className="glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel shrink-0"
            style={{ width: 280, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
          >
            <KanbanColumnView status="in_review" label="In Review" count={landed ? 2 : 1}>
              <KanbanCardView task={T116_REVIEW} showBadge={false} />
              <div ref={dstRef} className={`plan-slot ${open ? 'plan-slot-open' : ''} ${landed ? 'plan-slot-in' : ''}`}>
                <div>
                  <KanbanCardView task={T119_REVIEW} showBadge={false} />
                </div>
              </div>
            </KanbanColumnView>
          </div>
          {ghost && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: lerp(boxes!.src.x, boxes!.dst.x, e),
                top: lerp(boxes!.src.y, boxes!.dst.y, e) - 24 * Math.sin(Math.PI * e),
                width: lerp(boxes!.src.w * 0.45, boxes!.dst.w, e),
                zIndex: 40,
                opacity: Math.min(1, fp / 0.12) * (1 - clamp01((fp - 0.85) / 0.15)),
              }}
            >
              <CardFrame t={T119_REVIEW} style={{ boxShadow: 'var(--shadow-panel), 0 24px 48px -16px rgba(0,0,0,0.6)' }} />
            </div>
          )}
        </div>
      </Desk>
    </div>
  );
}
