import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { ClaudeUser, AssistantSay, ToolCall, ToolResult, BODY_CLS } from './stackParts';
import { KeyHint } from './paletteParts';
import { DeskWash } from './DeskWash';
import { MockScale } from './MockScale';

/**
 * The Plan section: story rows on desk cards, scroll-scrubbed card flights
 * into a sticky To Do column whose desk charges up per landing. Styles live
 * in marketing.css under "Plan section".
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

/** The column exactly as the Plan section leaves it. The Build section opens
 *  with this so the two are one list rather than two that look alike. */
export const TODO_COLUMN: TaskWithWorkspace[] = [SEED_TASK, ...SEQUENCE.map((k) => TASK_BY_SOURCE[k])];

/* ─── Mock pieces ─────────────────────────────────────────────────── */

/** Both states share one grid cell, so a source crossfading to what it looks
 *  like after the task exists cannot resize the pane it sits in. */
function Swap({ from, to, on, className = '' }: { from: ReactNode; to: ReactNode; on: boolean; className?: string }) {
  return (
    <span className={`grid ${className}`}>
      <span className="[grid-area:1/1] transition-opacity duration-300" style={{ opacity: on ? 0 : 1 }}>
        {from}
      </span>
      <span className="[grid-area:1/1] transition-opacity duration-300" style={{ opacity: on ? 1 : 0 }}>
        {to}
      </span>
    </span>
  );
}

const DRAFT = {
  name: 'Fix flaky signup e2e',
  /** The prompt the Build section's fourth session is working from. */
  description: 'The signup e2e fails about one run in five. Find out why.',
};

function ComposerSheet({ created, anchorRef }: { created: boolean; anchorRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon name="file-plus" className="w-3.5 h-3.5 text-ink/50" />
        <span className="flex-1 text-[13px] text-ink/50">New task</span>
        <span className="text-[13px] text-ink/35">To Do</span>
      </div>
      {/* px-10 on a 396px panel holds the app sheet's proportions, where the
          margins are 11% of a 44rem page. */}
      <div className="px-10 pt-6 pb-8">
        <div ref={anchorRef} className="text-lg font-semibold leading-snug">
          <Swap
            on={created}
            from={<span className="text-text-primary">{DRAFT.name}</span>}
            to={<span className="font-normal text-text-tertiary">Task name</span>}
          />
        </div>
        <div className="mt-3 text-sm leading-relaxed">
          <Swap
            on={created}
            from={<span className="text-ink/80">{DRAFT.description}</span>}
            to={<span className="text-text-tertiary">Describe the task, or write the prompt to start from&hellip;</span>}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 py-2 border-t border-ink/[0.06] text-[11px] text-ink/40">
        <KeyHint keys="esc" label="Draft is kept" />
        <span className="flex-1" />
        <span className="btn-secondary btn-compact shrink-0 whitespace-nowrap">Discard</span>
        <span
          className="btn-primary btn-compact shrink-0 whitespace-nowrap"
          style={{ opacity: created ? 0.5 : 1, transition: 'opacity 300ms ease' }}
        >
          Create task
          <span className="opacity-60">⌘↵</span>
        </span>
      </div>
    </div>
  );
}

function AgentPane({ created, anchorRef }: { created: boolean; anchorRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div className={`${BODY_CLS} !p-5`}>
      <ClaudeUser>break the API hardening work into tasks on the board</ClaudeUser>
      <AssistantSay>Rate limiting first — it blocks the other two. Creating it.</AssistantSay>
      <ToolCall
        name="Bash"
        args={'ouijit task create "Add rate-limit headers to the public API"\n       --prompt "429 + Retry-After on every public route"'}
      />
      {/* Rendered from the first frame either way: the result appearing must
          not move the anchor the flight leaves from. */}
      <div ref={anchorRef} className="transition-opacity duration-300" style={{ opacity: created ? 1 : 0 }}>
        <ToolResult>{'{"success": true, "task": {"taskNumber": 119}}'}</ToolResult>
      </div>
    </div>
  );
}

function IssuePane({ created, anchorRef }: { created: boolean; anchorRef?: (el: HTMLDivElement | null) => void }) {
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
          <span className="shrink-0 text-[13px]">
            <Swap
              on={created}
              className="justify-items-end"
              from={<span className="text-accent">Create task</span>}
              to={
                <span className="flex items-center gap-1.5 text-text-primary">
                  <span className="font-mono text-[12px]">T-{TASK_BY_SOURCE.issue.taskNumber}</span>
                  <span className="text-text-tertiary">To Do</span>
                  <Icon name="arrow-right" className="w-3.5 h-3.5 opacity-60" />
                </span>
              }
            />
          </span>
        </span>
      </div>
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

const ledge = (icon: string, label: string, hint?: string) => (
  <>
    <Icon name={icon} className="w-4 h-4 text-ink/50" />
    <span className="text-[13px] text-ink/70">{label}</span>
    {hint && <span className="ml-auto font-mono text-[11px] text-ink/35">{hint}</span>}
  </>
);

/* ─── Desk containers ─────────────────────────────────────────────── */

const DESK_GRAPHITE =
  'radial-gradient(120% 140% at 50% 0%, rgba(255, 255, 255, 0.05), transparent 60%), linear-gradient(180deg, #1c1d23, #131318)';

/* Each source desk carries one third of the prism; the To Do column
   reassembles the full sweep from the thirds whose cards have landed. */
const DESK_SLICE = { agent: 'a', issue: 'b', manual: 'c' } as const;

function Desk({
  slice,
  drain = 0,
  className = '',
  style,
  children,
}: {
  slice: (typeof DESK_SLICE)[SourceKey];
  /** 0..1 crossfade to graphite — the desk's color leaving with its card. */
  drain?: number;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`plan-desk desk-wash desk-wash--prism-${slice} ${className}`} style={style}>
      <DeskWash />
      {drain > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ borderRadius: 'inherit', backgroundImage: DESK_GRAPHITE, opacity: drain }}
        />
      )}
      {children}
    </div>
  );
}

/* ─── Scroll-scrubbed choreography ────────────────────────────────── */

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

/**
 * Progress per row is derived from its viewport position on every scroll
 * frame, so every landing plays forward on the way down and reverses on the
 * way back up — nothing is a one-shot.
 */
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

function Row({
  title,
  body,
  rowRef,
  children,
}: {
  title: string;
  body: string;
  rowRef?: (el: HTMLDivElement | null) => void;
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
  setSlot,
}: {
  open: Record<SourceKey, boolean>;
  landed: Record<SourceKey, boolean>;
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
    title: 'Agent assisted',
    body: 'Agents know how to use Ouijit out of the box.',
  },
  { key: 'issue', title: 'Pull from GitHub', body: 'Turn any open issue into a task on the board with one click.' },
  { key: 'manual', title: 'On the fly', body: '⌘N opens the composer from anywhere in the app.' },
];

function rowMock(
  key: SourceKey,
  firing: boolean,
  created: boolean,
  setSource: (key: SourceKey) => (el: HTMLDivElement | null) => void
) {
  if (key === 'agent')
    return (
      <Panel firing={firing} style={{ height: 250 }} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
        <AgentPane created={created} anchorRef={setSource('agent')} />
      </Panel>
    );
  if (key === 'issue')
    return (
      <Panel firing={firing} ledge={ledge('github-logo', 'Issues')}>
        <IssuePane created={created} anchorRef={setSource('issue')} />
      </Panel>
    );
  return (
    <Panel firing={firing}>
      <ComposerSheet created={created} anchorRef={setSource('manual')} />
    </Panel>
  );
}

/** The created card lifts out of the source and flies to its slot, scrubbed. */
function HandoffGhosts({ flightP, geom }: { flightP: (k: SourceKey) => number; geom: ScrubGeom }) {
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
          </div>
        );
      })}
    </>
  );
}

/** One gradient layer per source, stacked onto the column desk as its card
 * lands — the row hues, minus the dark linear base the desk already has. */
const SLICE_STOPS: Record<SourceKey, string> = {
  agent: 'oklch(80% 0.13 295), oklch(79% 0.13 330)',
  issue: 'oklch(78% 0.14 15), oklch(79% 0.14 45)',
  manual: 'oklch(84% 0.13 80), oklch(86% 0.14 130)',
};

/* The landed slices always span the full desk: one slice alone fills it,
   the next landing redistributes the stops rather than claiming a band, so
   no charge level leaves a graphite gap. Cards land in SEQUENCE order, so
   each step's gradient extends the previous one and the layers crossfade. */
const CHARGE_STEPS = SEQUENCE.map((_, i) =>
  SEQUENCE.slice(0, i + 1)
    .map((k) => SLICE_STOPS[k])
    .join(', ')
);

function ChargingDesk({ landed, children }: { landed: Record<SourceKey, boolean>; children: ReactNode }) {
  const count = SEQUENCE.filter((k) => landed[k]).length;
  return (
    <div className="plan-desk desk-wash" style={{ backgroundImage: DESK_GRAPHITE, padding: 36 }}>
      {CHARGE_STEPS.map((stops, i) => (
        <DeskWash
          key={i}
          style={
            {
              opacity: count > i ? 0.9 : 0,
              transition: 'opacity 700ms ease',
              '--wash': stops,
            } as React.CSSProperties
          }
        />
      ))}
      <div className="relative">{children}</div>
    </div>
  );
}

/* ─── The stage: desk cards, charging column, card flights ────────── */

/** What the desks give their mocks at full width. Below it a mock scales
 *  rather than reflows: an issue row and a composer are app layouts with
 *  min-widths of their own, not text. */
const ROW_MOCK_WIDTH = 460;
const COLUMN_WIDTH = 300;


/** Narrow viewports and reduced motion get the finished state with no
 * choreography: every card landed, the column charged, nothing in flight. */
function useStaticMode() {
  const [staticMode, setStaticMode] = useState(false);
  useEffect(() => {
    const queries = [window.matchMedia('(max-width: 999px)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
    const update = () => setStaticMode(queries.some((q) => q.matches));
    update();
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return staticMode;
}

const ALL_LANDED: Record<SourceKey, boolean> = { agent: true, issue: true, manual: true };

function CreateStage() {
  const staticMode = useStaticMode();
  const { stageRef, setRow, setSource, setSlot, progress, geom } = useScrubStage();
  const flightP = (k: SourceKey) => clamp01((progress[k] - 0.35) / 0.48);
  /** Just after the card lifts rather than as it does, so the source is not
   *  emptied while the card that left it is still fading in. */
  const created = (k: SourceKey) => staticMode || flightP(k) > 0.08;
  const open = staticMode ? ALL_LANDED : past(progress, 0.55);
  const landed = staticMode ? ALL_LANDED : past(progress, 0.76);
  return (
    <div ref={stageRef} className="relative flex gap-10 items-start plan-stage" style={{ marginTop: 72 }}>
      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 40 }}>
        {ROWS.map(({ key, title, body }) => (
          <Row key={key} title={title} body={body} rowRef={setRow(key)}>
            <Desk slice={DESK_SLICE[key]} drain={staticMode ? 0 : easeInOut(flightP(key))}>
              <MockScale width={ROW_MOCK_WIDTH}>
                {rowMock(key, !staticMode && progress[key] > 0.15 && progress[key] < 0.55, created(key), setSource)}
              </MockScale>
            </Desk>
          </Row>
        ))}
      </div>
      <div className="plan-column-rail shrink-0">
        <ChargingDesk landed={landed}>
          <MockScale width={COLUMN_WIDTH}>
            <div className="flex" style={{ minHeight: 470 }}>
              <ScrubColumn open={open} landed={landed} setSlot={setSlot} />
            </div>
          </MockScale>
        </ChargingDesk>
      </div>
      {!staticMode && geom && <HandoffGhosts flightP={flightP} geom={geom} />}
    </div>
  );
}


/* ─── The section ─────────────────────────────────────────────────── */

export function PlanSection() {
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale</h2>
      <CreateStage />
    </div>
  );
}
