import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { ClaudeUser, AssistantSay, ToolCall, ToolResult, BODY_CLS } from './stackParts';

/**
 * Concept lab for the Plan section, round three: full section mockups — the
 * headline, marketing framing around the mock UI, and a distinct motion
 * treatment per variant. Evaluated at /c/plan-lab/.
 */

type SourceKey = 'agent' | 'issue' | 'manual';

function task(taskNumber: number, name: string, branch: string): TaskWithWorkspace {
  return {
    taskNumber,
    name,
    status: 'todo',
    branch,
    worktreePath: `/demo/horizon/.ouijit/worktrees/T-${taskNumber}`,
    createdAt: '2026-05-08T09:00:00Z',
  };
}

const SEED_TASK = task(116, 'Bump deps for security advisory', 'bump-deps-advisory');

const TASK_BY_SOURCE: Record<SourceKey, TaskWithWorkspace> = {
  agent: task(119, 'Add rate-limit headers to the public API', 'api-rate-limit-headers'),
  issue: task(121, 'Support SSO re-auth prompt', 'sso-reauth-prompt'),
  manual: task(120, 'Fix flaky signup e2e', 'fix-signup-e2e'),
};

const SEQUENCE: SourceKey[] = ['agent', 'issue', 'manual'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Choreo {
  tasks: TaskWithWorkspace[];
  newest: number | null;
  firing: SourceKey | null;
  clearing?: boolean;
}

function toTasks(added: SourceKey[]): TaskWithWorkspace[] {
  return [SEED_TASK, ...added.map((key) => TASK_BY_SOURCE[key])];
}

/** Per-row landings for the story variants: rows fire as they scroll in. */
function useStoryChoreo() {
  const [added, setAdded] = useState<SourceKey[]>([]);
  const [firing, setFiring] = useState<SourceKey | null>(null);
  const land = (key: SourceKey) => {
    setFiring(key);
    setTimeout(() => setAdded((prev) => (prev.includes(key) ? prev : [...prev, key])), 450);
    setTimeout(() => setFiring((f) => (f === key ? null : f)), 1400);
  };
  const choreo: Choreo = {
    tasks: toTasks(added),
    newest: added.length > 0 ? TASK_BY_SOURCE[added[added.length - 1]].taskNumber : null,
    firing,
  };
  return { choreo, firing, land };
}

/* ─── Shared mock pieces ──────────────────────────────────────────── */

function ComposerFooter({ firing, anchorRef }: { firing: boolean; anchorRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div className={`kanban-add-form ${firing ? 'plan-lab-firing' : ''}`}>
      <input
        readOnly
        value="Fix flaky signup e2e"
        className="kanban-add-input w-full text-[15px] text-text-primary bg-transparent px-3 py-3 outline-none border-none"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
      />
      <div ref={anchorRef} className="flex flex-row-reverse items-center justify-start gap-2 px-2 py-1.5">
        <span className="kanban-add-button text-accent">
          Create
          <span className="kanban-add-button-hint">
            <Icon name="arrow-elbow-down-left" className="kanban-add-button-hint-icon" />
          </span>
        </span>
        <span className="kanban-add-button text-text-tertiary">Discard</span>
      </div>
    </div>
  );
}

function PlanColumn({
  choreo,
  framed = true,
  width = 300,
  composer = true,
}: {
  choreo: Choreo;
  framed?: boolean;
  width?: number;
  composer?: boolean;
}) {
  const column = (
    <KanbanColumnView
      status="todo"
      label="To Do"
      count={choreo.tasks.length}
      footer={composer ? <ComposerFooter firing={choreo.firing === 'manual'} /> : undefined}
    >
      <div className={choreo.clearing ? 'plan-lab-clearing' : undefined}>
        {choreo.tasks.map((t) => (
          <div key={t.taskNumber} className={t.taskNumber === choreo.newest ? 'plan-lab-card-in' : undefined}>
            <KanbanCardView task={t} showBadge={false} />
          </div>
        ))}
      </div>
    </KanbanColumnView>
  );
  if (!framed) return column;
  return (
    <div
      className="glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel shrink-0"
      style={{ width, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      {column}
    </div>
  );
}

function AgentPane({
  compact = false,
  anchorRef,
}: {
  compact?: boolean;
  anchorRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className={`${BODY_CLS} !p-5`}>
      <ClaudeUser>break the API hardening epic into tasks on the board</ClaudeUser>
      <AssistantSay>Rate limiting first — it blocks the other two. Creating it.</AssistantSay>
      <ToolCall
        name="Bash"
        args={'ouijit task create "Add rate-limit headers to the public API"\n       --prompt "429 + Retry-After on every public route"'}
      />
      <div ref={anchorRef}>
        <ToolResult>{'{"success": true, "task": {"taskNumber": 119}}'}</ToolResult>
      </div>
      {!compact && <AssistantSay>Created T-119. Two more to go.</AssistantSay>}
    </div>
  );
}

function IssuePane({
  single = false,
  anchorRef,
}: {
  single?: boolean;
  anchorRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="w-full my-auto flex flex-col py-3">
      <div className="px-4 pb-1 text-[13px] text-text-tertiary">Open</div>
      <div ref={anchorRef} className="relative w-full px-4 py-2 flex flex-col gap-0.5 bg-ink/[0.07]">
        <span className="flex items-baseline gap-2">
          <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">Support SSO re-auth prompt</span>
          <span className="shrink-0 text-[13px] text-text-tertiary">2 days ago</span>
        </span>
        <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
          <Icon name="circle-dashed" className="w-3.5 h-3.5 shrink-0 text-vcs-added" />
          <span className="shrink-0">jkataja</span>
          <span className="flex-1 min-w-0 truncate font-mono text-[12px]">#491</span>
          <span className="shrink-0 text-[13px] text-accent">Create task</span>
        </span>
      </div>
      {!single && (
        <div className="relative w-full px-4 py-2 flex flex-col gap-0.5 opacity-50">
          <span className="flex items-baseline gap-2">
            <span className="flex-1 min-w-0 truncate text-[15px] text-text-primary">Export audit log as CSV</span>
            <span className="shrink-0 text-[13px] text-text-tertiary">4 days ago</span>
          </span>
          <span className="flex items-center gap-2 min-w-0 text-[13px] text-text-tertiary">
            <Icon name="circle-dashed" className="w-3.5 h-3.5 shrink-0 text-vcs-added" />
            <span className="shrink-0">mara-oduya</span>
            <span className="flex-1 min-w-0 truncate font-mono text-[12px]">#488</span>
          </span>
        </div>
      )}
    </div>
  );
}

function PlanPane({ short = false }: { short?: boolean }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden px-5 py-4">
      <div className="app-markdown plan-markdown">
        <h1>Add rate-limit headers to the public API</h1>
        <h2>Steps</h2>
        <ul>
          <li>
            <input type="checkbox" checked readOnly /> Pick the limiter — sliding window in{' '}
            <code>src/api/rateLimit.ts</code>
          </li>
          <li>
            <input type="checkbox" readOnly /> Send <code>429</code> with <code>Retry-After</code> on every public
            route
          </li>
          {!short && (
            <li>
              <input type="checkbox" readOnly /> Document the limits in <code>docs/api.md</code>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Panel({
  firing = false,
  className = '',
  style,
  ledge,
  position = 'relative',
  children,
}: {
  firing?: boolean;
  className?: string;
  style?: React.CSSProperties;
  ledge?: ReactNode;
  /** glass-bevel's pseudo-elements need a positioned box either way. */
  position?: 'relative' | 'absolute';
  children: ReactNode;
}) {
  return (
    <div
      className={`glass-bevel ${position} flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel min-h-0 ${
        firing ? 'plan-lab-firing' : ''
      } ${className}`}
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', ...style }}
    >
      {ledge && <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">{ledge}</div>}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}

const ledge = (icon: string, label: string, hint?: string) => (
  <>
    <Icon name={icon} className="w-4 h-4 text-ink/50" />
    <span className="text-[13px] text-ink/70">{label}</span>
    {hint && <span className="ml-auto font-mono text-[11px] text-ink/35">{hint}</span>}
  </>
);

/* ─── Variant 3: story rows beside a sticky column ────────────────── */

function StoryRow({
  title,
  body,
  onVisible,
  children,
}: {
  title: string;
  body: string;
  onVisible?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onVisible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onVisible();
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="plan-v3-row">
      <div className="plan-v3-copy">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="plan-v3-mock">{children}</div>
    </div>
  );
}



/* ─── Containers: desktop backdrops and inset wells ───────────────── */

const DESK_HUES = {
  indigo:
    'radial-gradient(120% 140% at 15% 0%, rgba(99, 102, 241, 0.32), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(56, 189, 248, 0.14), transparent 55%), linear-gradient(180deg, #191a2e, #121218)',
  teal: 'radial-gradient(120% 140% at 85% 0%, rgba(45, 212, 191, 0.22), transparent 60%), radial-gradient(120% 120% at 0% 100%, rgba(99, 102, 241, 0.16), transparent 55%), linear-gradient(180deg, #14201f, #101314)',
  rose: 'radial-gradient(120% 140% at 20% 10%, rgba(233, 103, 159, 0.26), transparent 60%), radial-gradient(120% 130% at 100% 90%, rgba(168, 85, 247, 0.16), transparent 60%), linear-gradient(180deg, #221521, #131015)',
  violet:
    'radial-gradient(130% 120% at 80% 0%, rgba(168, 85, 247, 0.22), transparent 55%), radial-gradient(140% 120% at 0% 100%, rgba(59, 130, 246, 0.16), transparent 60%), linear-gradient(180deg, #1a1626, #111016)',
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

function Well({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`plan-well ${className}`}>{children}</div>;
}

/* ─── Round four: scroll-scrubbed landings with explicit connections ─
 *
 * Progress per row is derived from its viewport position on every scroll
 * frame, so every landing plays forward on the way down and reverses on the
 * way back up — nothing is a one-shot.
 */

const HUE_ACCENT: Record<SourceKey, string> = {
  agent: '#818cf8',
  issue: '#2dd4bf',
  manual: '#e9679f',
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ScrubGeom {
  source: Record<SourceKey, Box>;
  slot: Record<SourceKey, Box>;
}

function useScrubStage() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef<Partial<Record<SourceKey, HTMLElement | null>>>({});
  const sourceEls = useRef<Partial<Record<SourceKey, HTMLElement | null>>>({});
  const slotEls = useRef<Partial<Record<SourceKey, HTMLElement | null>>>({});
  const [progress, setProgress] = useState<Record<SourceKey, number>>({ agent: 0, issue: 0, manual: 0 });
  const [geom, setGeom] = useState<ScrubGeom | null>(null);
  const sig = useRef('');

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight;
      const nextP: Record<SourceKey, number> = { agent: 0, issue: 0, manual: 0 };
      for (const key of SEQUENCE) {
        const el = rowEls.current[key];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        nextP[key] = clamp01((vh * 0.92 - center) / (vh * 0.42));
      }
      let nextG: ScrubGeom | null = null;
      const stage = stageRef.current;
      if (stage) {
        const s = stage.getBoundingClientRect();
        const source = {} as ScrubGeom['source'];
        const slot = {} as ScrubGeom['slot'];
        let complete = true;
        for (const key of SEQUENCE) {
          const so = sourceEls.current[key];
          const sl = slotEls.current[key];
          if (!so || !sl) {
            complete = false;
            break;
          }
          const a = so.getBoundingClientRect();
          const b = sl.getBoundingClientRect();
          source[key] = { x: a.left - s.left, y: a.top - s.top, w: a.width, h: a.height };
          slot[key] = { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height };
        }
        if (complete) nextG = { source, slot };
      }
      const nextSig = JSON.stringify([
        SEQUENCE.map((k) => Math.round(nextP[k] * 500)),
        nextG &&
          SEQUENCE.map((k) => [
            Math.round(nextG!.source[k].x),
            Math.round(nextG!.source[k].y),
            Math.round(nextG!.slot[k].x),
            Math.round(nextG!.slot[k].y),
            Math.round(nextG!.slot[k].h),
          ]),
      ]);
      if (nextSig !== sig.current) {
        sig.current = nextSig;
        setProgress(nextP);
        setGeom(nextG);
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

  const setRow = (key: SourceKey) => (el: HTMLDivElement | null) => void (rowEls.current[key] = el);
  const setSource = (key: SourceKey) => (el: HTMLDivElement | null) => void (sourceEls.current[key] = el);
  const setSlot = (key: SourceKey) => (el: HTMLDivElement | null) => void (slotEls.current[key] = el);
  return { stageRef, setRow, setSource, setSlot, progress, geom };
}

function ScrubRow({
  title,
  body,
  rowRef,
  children,
}: {
  title: string;
  body: string;
  rowRef: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div ref={rowRef} className="plan-v3-row">
      <div className="plan-v3-copy">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="plan-v3-mock">{children}</div>
    </div>
  );
}

/** Column with a fixed slot per source; slots open and fill from scroll state. */
function ScrubColumn({
  open,
  landed,
  hues = false,
  setSlot,
}: {
  open: Record<SourceKey, boolean>;
  landed: Record<SourceKey, boolean>;
  hues?: boolean;
  setSlot: (key: SourceKey) => (el: HTMLDivElement | null) => void;
}) {
  const count = 1 + SEQUENCE.filter((k) => landed[k]).length;
  return (
    <div
      className="glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel shrink-0"
      style={{ width: 300, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <KanbanColumnView status="todo" label="To Do" count={count}>
        <KanbanCardView task={SEED_TASK} showBadge={false} />
        {SEQUENCE.map((k) => (
          <div
            key={k}
            ref={setSlot(k)}
            className={`plan-slot ${open[k] ? 'plan-slot-open' : ''} ${landed[k] ? 'plan-slot-in' : ''}`}
          >
            <div>
              <KanbanCardView task={TASK_BY_SOURCE[k]} showBadge={false} />
              {hues && (
                <span
                  className="absolute left-0 top-0 bottom-0"
                  style={{
                    width: 2,
                    background: HUE_ACCENT[k],
                    opacity: landed[k] ? 1 : 0,
                    transition: 'opacity 300ms ease',
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </KanbanColumnView>
    </div>
  );
}

const past = (progress: Record<SourceKey, number>, t: number) =>
  Object.fromEntries(SEQUENCE.map((k) => [k, progress[k] >= t])) as Record<SourceKey, boolean>;

const ROWS: { key: SourceKey; title: string; body: string }[] = [
  {
    key: 'agent',
    title: 'Delegate the breakdown',
    body: 'An agent splits the epic and files each task over the CLI, prompt and all.',
  },
  { key: 'issue', title: 'Pull from GitHub', body: 'An open issue becomes a task on the board with one click.' },
  { key: 'manual', title: 'Or just type', body: 'The composer sits at the bottom of the column, one ⌘N away.' },
];

function rowMock(key: SourceKey, firing: boolean, setSource: (key: SourceKey) => (el: HTMLDivElement | null) => void, fire?: string) {
  const fireStyle = fire ? ({ '--plan-fire': fire } as React.CSSProperties) : undefined;
  if (key === 'agent')
    return (
      <Panel firing={firing} style={{ height: 330, ...fireStyle }} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
        <AgentPane compact anchorRef={setSource('agent')} />
      </Panel>
    );
  if (key === 'issue')
    return (
      <Panel firing={firing} style={fireStyle} ledge={ledge('github-logo', 'Issues')}>
        <IssuePane anchorRef={setSource('issue')} />
      </Panel>
    );
  return (
    <Panel firing={firing} style={fireStyle}>
      <div className="p-5">
        <ComposerFooter firing={false} anchorRef={setSource('manual')} />
      </div>
    </Panel>
  );
}

/** The created card lifts out of the source and flies to its slot, scrubbed. */
function HandoffGhosts({
  flightP,
  geom,
  hues = false,
}: {
  flightP: (k: SourceKey) => number;
  geom: ScrubGeom;
  hues?: boolean;
}) {
  return (
    <>
      {SEQUENCE.map((k) => {
        const f = flightP(k);
        if (f <= 0 || f >= 1) return null;
        const e = easeInOut(f);
        const src = geom.source[k];
        const dst = geom.slot[k];
        const left = lerp(src.x, dst.x, e);
        const top = lerp(src.y, dst.y, e) - 28 * Math.sin(Math.PI * e);
        const width = lerp(src.w, dst.w, e);
        const opacity = Math.min(1, f / 0.12) * (1 - clamp01((f - 0.85) / 0.15));
        return (
          <div
            key={k}
            className="absolute pointer-events-none glass-bevel rounded-[10px] overflow-hidden border border-bezel-panel"
            style={{
              left,
              top,
              width,
              zIndex: 40,
              background: 'var(--color-terminal-bg)',
              boxShadow: 'var(--shadow-panel), 0 24px 48px -16px rgba(0, 0, 0, 0.6)',
              opacity,
            }}
          >
            <KanbanCardView task={TASK_BY_SOURCE[k]} showBadge={false} />
            {hues && <span className="absolute left-0 top-0 bottom-0" style={{ width: 2, background: HUE_ACCENT[k] }} />}
          </div>
        );
      })}
    </>
  );
}

/* ─── Variant 4a: handoff on the shared desktop ───────────────────── */

export function VariantScrubHandoffDesk() {
  const { stageRef, setRow, setSource, setSlot, progress, geom } = useScrubStage();
  const flightP = (k: SourceKey) => clamp01((progress[k] - 0.35) / 0.48);
  const open = past(progress, 0.55);
  const landed = past(progress, 0.76);
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <Desk hue="indigo" style={{ marginTop: 64, padding: '64px 56px' }}>
        <div ref={stageRef} className="relative flex gap-10 items-start">
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 130 }}>
            {ROWS.map(({ key, title, body }) => (
              <ScrubRow key={key} title={title} body={body} rowRef={setRow(key)}>
                {rowMock(key, progress[key] > 0.15 && progress[key] < 0.55, setSource)}
              </ScrubRow>
            ))}
            <StoryRow title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
              <Panel ledge={ledge('file-text', 'plan.md')}>
                <PlanPane short />
              </Panel>
            </StoryRow>
          </div>
          <div className="shrink-0 sticky" style={{ top: 120, width: 300 }}>
            <div className="flex" style={{ minHeight: 480 }}>
              <ScrubColumn open={open} landed={landed} setSlot={setSlot} />
            </div>
          </div>
          {geom && <HandoffGhosts flightP={flightP} geom={geom} />}
        </div>
      </Desk>
    </div>
  );
}

/* ─── Variant 4b: handoff — the created card flies into the column ──── */

export function VariantScrubHandoff() {
  const { stageRef, setRow, setSource, setSlot, progress, geom } = useScrubStage();
  const flightP = (k: SourceKey) => clamp01((progress[k] - 0.35) / 0.48);
  const open = past(progress, 0.55);
  const landed = past(progress, 0.76);
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <div ref={stageRef} className="relative flex gap-10 items-start" style={{ marginTop: 72 }}>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 110 }}>
          {ROWS.map(({ key, title, body }) => (
            <ScrubRow key={key} title={title} body={body} rowRef={setRow(key)}>
              <Well>{rowMock(key, progress[key] > 0.15 && progress[key] < 0.55, setSource)}</Well>
            </ScrubRow>
          ))}
          <StoryRow title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
            <Well>
              <Panel ledge={ledge('file-text', 'plan.md')}>
                <PlanPane short />
              </Panel>
            </Well>
          </StoryRow>
        </div>
        <div className="shrink-0 sticky" style={{ top: 110, width: 372 }}>
          <Well>
            <div className="flex" style={{ minHeight: 470 }}>
              <ScrubColumn open={open} landed={landed} setSlot={setSlot} />
            </div>
          </Well>
        </div>
        {geom && <HandoffGhosts flightP={flightP} geom={geom} />}
      </div>
    </div>
  );
}

/* ─── Variant 4c: desk cards, the column desk charging up per landing ─ */

/** One gradient layer per source, stacked onto the column desk as its card
 * lands — the row hues, minus the dark linear base the desk already has. */
const CHARGE_LAYERS: Record<SourceKey, string> = {
  agent:
    'radial-gradient(120% 140% at 15% 0%, rgba(99, 102, 241, 0.35), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(56, 189, 248, 0.16), transparent 55%)',
  issue:
    'radial-gradient(120% 140% at 85% 0%, rgba(45, 212, 191, 0.24), transparent 60%), radial-gradient(120% 120% at 0% 100%, rgba(99, 102, 241, 0.14), transparent 55%)',
  manual:
    'radial-gradient(120% 140% at 20% 100%, rgba(233, 103, 159, 0.26), transparent 60%), radial-gradient(120% 130% at 100% 20%, rgba(168, 85, 247, 0.16), transparent 60%)',
};

function ChargingDesk({
  landed,
  charges,
  children,
}: {
  landed: Record<SourceKey, boolean>;
  charges: Record<SourceKey, string>;
  children: ReactNode;
}) {
  return (
    <div className="plan-desk" style={{ backgroundImage: DESK_HUES.graphite, padding: 36 }}>
      {SEQUENCE.map((k) => (
        <div
          key={k}
          className="absolute inset-0 pointer-events-none"
          style={{
            borderRadius: 'inherit',
            backgroundImage: charges[k],
            opacity: landed[k] ? 1 : 0,
            transition: 'opacity 700ms ease',
          }}
        />
      ))}
      <div className="relative">{children}</div>
    </div>
  );
}

/** A colorway: one desk wallpaper per row (agent, issue, manual, plan) and the
 * charge layer each landing stacks onto the column desk. */
interface Colorway {
  desks: [string, string, string, string];
  charges: Record<SourceKey, string>;
}

const COLORWAYS: Record<string, Colorway> = {
  spectrum: {
    desks: [DESK_HUES.indigo, DESK_HUES.teal, DESK_HUES.rose, DESK_HUES.violet],
    charges: CHARGE_LAYERS,
  },
  ocean: {
    desks: [
      'radial-gradient(120% 140% at 15% 0%, rgba(59, 130, 246, 0.32), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(56, 189, 248, 0.15), transparent 55%), linear-gradient(180deg, #16203a, #101420)',
      'radial-gradient(120% 140% at 85% 0%, rgba(56, 189, 248, 0.26), transparent 60%), radial-gradient(120% 120% at 0% 100%, rgba(37, 99, 235, 0.18), transparent 55%), linear-gradient(180deg, #122030, #0f1218)',
      'radial-gradient(120% 140% at 20% 10%, rgba(103, 232, 249, 0.20), transparent 60%), radial-gradient(120% 130% at 100% 90%, rgba(59, 130, 246, 0.18), transparent 60%), linear-gradient(180deg, #101c2c, #0e1116)',
      'radial-gradient(130% 120% at 80% 0%, rgba(96, 165, 250, 0.24), transparent 55%), radial-gradient(140% 120% at 0% 100%, rgba(45, 212, 191, 0.14), transparent 60%), linear-gradient(180deg, #131c2e, #0f1218)',
    ],
    charges: {
      agent:
        'radial-gradient(120% 140% at 15% 0%, rgba(59, 130, 246, 0.34), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(37, 99, 235, 0.14), transparent 55%)',
      issue:
        'radial-gradient(120% 140% at 85% 0%, rgba(56, 189, 248, 0.24), transparent 60%), radial-gradient(120% 120% at 0% 100%, rgba(59, 130, 246, 0.14), transparent 55%)',
      manual:
        'radial-gradient(120% 140% at 20% 100%, rgba(103, 232, 249, 0.20), transparent 60%), radial-gradient(120% 130% at 100% 20%, rgba(45, 212, 191, 0.14), transparent 60%)',
    },
  },
  sunset: {
    desks: [
      'radial-gradient(120% 140% at 15% 0%, rgba(251, 191, 36, 0.26), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(249, 115, 22, 0.14), transparent 55%), linear-gradient(180deg, #241c10, #141110)',
      'radial-gradient(120% 140% at 85% 0%, rgba(251, 113, 133, 0.24), transparent 60%), radial-gradient(120% 120% at 0% 100%, rgba(249, 115, 22, 0.16), transparent 55%), linear-gradient(180deg, #261414, #131011)',
      'radial-gradient(120% 140% at 20% 10%, rgba(244, 63, 94, 0.24), transparent 60%), radial-gradient(120% 130% at 100% 90%, rgba(217, 70, 239, 0.14), transparent 60%), linear-gradient(180deg, #241019, #120f13)',
      'radial-gradient(130% 120% at 80% 0%, rgba(192, 132, 252, 0.20), transparent 55%), radial-gradient(140% 120% at 0% 100%, rgba(244, 114, 182, 0.14), transparent 60%), linear-gradient(180deg, #1f1424, #111016)',
    ],
    charges: {
      agent:
        'radial-gradient(120% 140% at 15% 0%, rgba(251, 191, 36, 0.28), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(249, 115, 22, 0.14), transparent 55%)',
      issue:
        'radial-gradient(120% 140% at 85% 0%, rgba(251, 113, 133, 0.24), transparent 60%), radial-gradient(120% 120% at 0% 100%, rgba(249, 115, 22, 0.12), transparent 55%)',
      manual:
        'radial-gradient(120% 140% at 20% 100%, rgba(244, 63, 94, 0.24), transparent 60%), radial-gradient(120% 130% at 100% 20%, rgba(217, 70, 239, 0.14), transparent 60%)',
    },
  },
  noir: {
    desks: [DESK_HUES.graphite, DESK_HUES.graphite, DESK_HUES.graphite, DESK_HUES.graphite],
    charges: CHARGE_LAYERS,
  },
};

export function VariantScrubHue({ colorway = 'spectrum' }: { colorway?: keyof typeof COLORWAYS }) {
  const { stageRef, setRow, setSource, setSlot, progress, geom } = useScrubStage();
  const flightP = (k: SourceKey) => clamp01((progress[k] - 0.35) / 0.48);
  const open = past(progress, 0.55);
  const landed = past(progress, 0.76);
  const cw = COLORWAYS[colorway];
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <div ref={stageRef} className="relative flex gap-10 items-start" style={{ marginTop: 72 }}>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 110 }}>
          {ROWS.map(({ key, title, body }, i) => (
            <ScrubRow key={key} title={title} body={body} rowRef={setRow(key)}>
              <Desk hue="graphite" style={{ backgroundImage: cw.desks[i] }}>
                {rowMock(key, progress[key] > 0.15 && progress[key] < 0.55, setSource)}
              </Desk>
            </ScrubRow>
          ))}
          <StoryRow title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
            <Desk hue="graphite" style={{ backgroundImage: cw.desks[3] }}>
              <Panel ledge={ledge('file-text', 'plan.md')}>
                <PlanPane short />
              </Panel>
            </Desk>
          </StoryRow>
        </div>
        <div className="shrink-0 sticky" style={{ top: 110, width: 372 }}>
          <ChargingDesk landed={landed} charges={cw.charges}>
            <div className="flex" style={{ minHeight: 470 }}>
              <ScrubColumn open={open} landed={landed} setSlot={setSlot} />
            </div>
          </ChargingDesk>
        </div>
        {geom && <HandoffGhosts flightP={flightP} geom={geom} />}
      </div>
    </div>
  );
}

/* ─── Variant 3d: each mock on its own desktop card ───────────────── */

export function VariantStoryDesk() {
  const { choreo, firing, land } = useStoryChoreo();
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <div className="flex gap-10 items-start" style={{ marginTop: 72 }}>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 110 }}>
          <StoryRow
            title="Delegate the breakdown"
            body="An agent splits the epic and files each task over the CLI, prompt and all."
            onVisible={() => land('agent')}
          >
            <Desk hue="indigo">
              <Panel firing={firing === 'agent'} style={{ height: 330 }} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
                <AgentPane compact />
              </Panel>
            </Desk>
          </StoryRow>
          <StoryRow
            title="Pull from GitHub"
            body="An open issue becomes a task on the board with one click."
            onVisible={() => land('issue')}
          >
            <Desk hue="teal">
              <Panel firing={firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
                <IssuePane />
              </Panel>
            </Desk>
          </StoryRow>
          <StoryRow
            title="Or just type"
            body="The composer sits at the bottom of the column, one ⌘N away."
            onVisible={() => land('manual')}
          >
            <Desk hue="rose">
              <Panel firing={firing === 'manual'}>
                <div className="p-5">
                  <ComposerFooter firing={false} />
                </div>
              </Panel>
            </Desk>
          </StoryRow>
          <StoryRow title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
            <Desk hue="violet">
              <Panel ledge={ledge('file-text', 'plan.md')}>
                <PlanPane short />
              </Panel>
            </Desk>
          </StoryRow>
        </div>
        <div className="shrink-0 sticky" style={{ top: 110, width: 372 }}>
          <Desk hue="graphite" style={{ padding: 36 }}>
            <div className="flex" style={{ height: 470 }}>
              <PlanColumn choreo={choreo} framed width={300} composer={false} />
            </div>
          </Desk>
        </div>
      </div>
    </div>
  );
}

/* ─── Variant 3e: inset wells, mocks cropped at the edge ──────────── */

export function VariantStoryWell() {
  const { choreo, firing, land } = useStoryChoreo();
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <div className="flex gap-10 items-start" style={{ marginTop: 72 }}>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 110 }}>
          <StoryRow
            title="Delegate the breakdown"
            body="An agent splits the epic and files each task over the CLI, prompt and all."
            onVisible={() => land('agent')}
          >
            <Well>
              <Panel firing={firing === 'agent'} style={{ height: 330 }} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
                <AgentPane compact />
              </Panel>
            </Well>
          </StoryRow>
          <StoryRow
            title="Pull from GitHub"
            body="An open issue becomes a task on the board with one click."
            onVisible={() => land('issue')}
          >
            <Well>
              <Panel firing={firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
                <IssuePane />
              </Panel>
            </Well>
          </StoryRow>
          <StoryRow
            title="Or just type"
            body="The composer sits at the bottom of the column, one ⌘N away."
            onVisible={() => land('manual')}
          >
            <Well>
              <Panel firing={firing === 'manual'}>
                <div className="p-5">
                  <ComposerFooter firing={false} />
                </div>
              </Panel>
            </Well>
          </StoryRow>
          <StoryRow title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
            <Well>
              <Panel ledge={ledge('file-text', 'plan.md')}>
                <PlanPane short />
              </Panel>
            </Well>
          </StoryRow>
        </div>
        <div className="shrink-0 sticky" style={{ top: 110, width: 372 }}>
          <Well>
            <div className="flex" style={{ height: 470 }}>
              <PlanColumn choreo={choreo} framed width={300} composer={false} />
            </div>
          </Well>
        </div>
      </div>
    </div>
  );
}

/* ─── Variant 3f: the whole stage on one shared desktop ───────────── */

export function VariantStoryOneDesk() {
  const { choreo, firing, land } = useStoryChoreo();
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <Desk hue="indigo" style={{ marginTop: 64, padding: '64px 56px' }}>
        <div className="flex gap-10 items-start">
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 130 }}>
            <StoryRow
              title="Delegate the breakdown"
              body="An agent splits the epic and files each task over the CLI, prompt and all."
              onVisible={() => land('agent')}
            >
              <Panel firing={firing === 'agent'} style={{ height: 330 }} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
                <AgentPane compact />
              </Panel>
            </StoryRow>
            <StoryRow
              title="Pull from GitHub"
              body="An open issue becomes a task on the board with one click."
              onVisible={() => land('issue')}
            >
              <Panel firing={firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
                <IssuePane />
              </Panel>
            </StoryRow>
            <StoryRow
              title="Or just type"
              body="The composer sits at the bottom of the column, one ⌘N away."
              onVisible={() => land('manual')}
            >
              <Panel firing={firing === 'manual'}>
                <div className="p-5">
                  <ComposerFooter firing={false} />
                </div>
              </Panel>
            </StoryRow>
            <StoryRow title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
              <Panel ledge={ledge('file-text', 'plan.md')}>
                <PlanPane short />
              </Panel>
            </StoryRow>
          </div>
          <div className="shrink-0 sticky" style={{ top: 120, width: 300 }}>
            <div className="flex" style={{ height: 480 }}>
              <PlanColumn choreo={choreo} framed width={300} composer={false} />
            </div>
          </div>
        </div>
      </Desk>
    </div>
  );
}
