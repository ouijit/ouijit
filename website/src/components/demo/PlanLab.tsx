import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { KanbanAddInput } from '../../ouijit-ui/components/kanban/KanbanAddInput';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { ClaudeUser, AssistantSay, ToolCall, ToolResult, BODY_CLS } from './stackParts';

/**
 * Concept lab for the Plan section: four switcher/layout mechanics around the
 * same story — sources on one side, an accumulating To Do column on the other.
 * Not linked from anywhere; evaluated at /c/plan-lab/.
 */

type SourceKey = 'agent' | 'manual' | 'issue' | 'plan';

interface Source {
  key: SourceKey;
  label: string;
  icon: string;
  hint: string;
  /** The card this source contributes; the plan previewer deepens instead. */
  task?: TaskWithWorkspace;
}

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

const SOURCES: Source[] = [
  {
    key: 'agent',
    label: 'Ask an agent',
    icon: 'terminal',
    hint: 'ouijit task create',
    task: task(119, 'Add rate-limit headers to the public API', 'api-rate-limit-headers'),
  },
  {
    key: 'manual',
    label: 'New task',
    icon: 'plus',
    hint: '⌘N',
    task: task(120, 'Fix flaky signup e2e', 'fix-signup-e2e'),
  },
  {
    key: 'issue',
    label: 'From a GitHub issue',
    icon: 'github-logo',
    hint: '#491',
    task: task(121, 'Support SSO re-auth prompt', 'sso-reauth-prompt'),
  },
  {
    key: 'plan',
    label: 'Write the plan',
    icon: 'file-text',
    hint: 'plan.md',
  },
];

const sourceByKey = (key: SourceKey) => SOURCES.find((s) => s.key === key)!;

/** Active source drives the column: its card lands shortly after it opens. */
function useAccumulator(active: SourceKey) {
  const [added, setAdded] = useState<SourceKey[]>([]);
  useEffect(() => {
    const source = sourceByKey(active);
    if (!source.task) return;
    const timer = setTimeout(() => {
      setAdded((prev) => (prev.includes(active) ? prev : [...prev, active]));
    }, 500);
    return () => clearTimeout(timer);
  }, [active]);
  const tasks = [...added.map((key) => sourceByKey(key).task!), SEED_TASK];
  return { tasks, newest: added.length > 0 ? sourceByKey(added[added.length - 1]).task!.taskNumber : null };
}

/* ─── The persistent column ───────────────────────────────────────── */

function PlanColumn({
  tasks,
  newest,
  framed = true,
  showComposer = false,
  width = 300,
}: {
  tasks: TaskWithWorkspace[];
  newest: number | null;
  framed?: boolean;
  showComposer?: boolean;
  width?: number;
}) {
  const column = (
    <KanbanColumnView
      status="todo"
      label="To Do"
      count={tasks.length}
      footer={showComposer ? <KanbanAddInput onAdd={() => {}} /> : undefined}
    >
      {tasks.map((t) => (
        <div key={t.taskNumber} className={t.taskNumber === newest ? 'plan-lab-card-in' : undefined}>
          <KanbanCardView task={t} showBadge={false} />
        </div>
      ))}
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

/* ─── Source stages ───────────────────────────────────────────────── */

function AgentStage() {
  return (
    <div className={`${BODY_CLS} !p-5`}>
      <ClaudeUser>break the API hardening epic into tasks on the board</ClaudeUser>
      <AssistantSay>Rate limiting first — it blocks the other two. Creating it.</AssistantSay>
      <ToolCall
        name="Bash"
        args={'ouijit task create "Add rate-limit headers to the public API"\n       --prompt "429 + Retry-After on every public route"'}
      />
      <ToolResult>{'{"success": true, "task": {"taskNumber": 119}}'}</ToolResult>
      <AssistantSay>Created T-119. Two more to go.</AssistantSay>
    </div>
  );
}

function ManualStage() {
  return (
    <div className="w-full max-w-[340px] mx-auto my-auto">
      <div
        className="kanban-add-form rounded-[10px] overflow-hidden"
        style={{ background: 'color-mix(in srgb, var(--color-ink) 3%, transparent)' }}
      >
        <input
          readOnly
          value="Fix flaky signup e2e"
          className="kanban-add-input w-full text-[15px] text-text-primary bg-transparent px-3 py-3 outline-none border-none"
          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        />
        <textarea
          readOnly
          rows={3}
          className="kanban-add-description w-full text-sm leading-relaxed text-text-secondary bg-transparent px-3 py-2.5 outline-none border-none resize-none"
          value={'Seed the test account before the run instead of relying on the previous spec.'}
        />
        <div className="flex flex-row-reverse items-center justify-start gap-2 px-2 py-1.5">
          <span className="kanban-add-button text-accent">
            Create
            <span className="kanban-add-button-hint">
              <Icon name="arrow-elbow-down-left" className="kanban-add-button-hint-icon" />
            </span>
          </span>
          <span className="kanban-add-button text-text-tertiary">Discard</span>
        </div>
      </div>
    </div>
  );
}

function IssueStage() {
  return (
    <div className="w-full max-w-[400px] mx-auto my-auto flex flex-col">
      <div className="px-4 pb-1 text-[13px] text-text-tertiary">Open</div>
      <div className="relative w-full px-4 py-2 flex flex-col gap-0.5 rounded-lg bg-ink/[0.07]">
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

function PlanStage() {
  return (
    <div className="flex flex-col w-full h-full">
      <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">
        <Icon name="file-text" className="w-4 h-4 text-ink/50" />
        <span className="text-[13px] text-ink/50 font-mono">plan.md</span>
      </div>
      <div className="flex-1 overflow-hidden px-5 py-4">
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
            <li>
              <input type="checkbox" readOnly /> Document the limits in <code>docs/api.md</code>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function renderStage(key: SourceKey) {
  if (key === 'agent') return <AgentStage />;
  if (key === 'manual') return <ManualStage />;
  if (key === 'issue') return <IssueStage />;
  return <PlanStage />;
}

/** Panel frame for a stage where the concept doesn't supply its own chrome. */
function StageFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="glass-bevel relative flex flex-1 min-w-0 rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      {children}
    </div>
  );
}

/* ─── Concept 1: stacked sources ──────────────────────────────────── */

export function ConceptStack() {
  const [order, setOrder] = useState<SourceKey[]>(['agent', 'manual', 'issue', 'plan']);
  const active = order[0];
  const { tasks, newest } = useAccumulator(active);
  const position = new Map(order.map((key, i) => [key, i]));

  return (
    <div className="flex gap-6 items-stretch" style={{ height: 520 }}>
      <div className="flex-1 min-w-0 relative">
        <div className="absolute" style={{ inset: `${18 + (SOURCES.length - 1) * 24}px 0 0 0` }}>
          {SOURCES.map((source) => {
            const pos = position.get(source.key) ?? 0;
            const isActive = pos === 0;
            return (
              <TerminalCardView
                key={source.key}
                ptyId={`lab-${source.key}`}
                isActive={isActive}
                backDepth={isActive ? 0 : pos}
                onClick={
                  isActive
                    ? undefined
                    : () => setOrder((prev) => [source.key, ...prev.filter((k) => k !== source.key)])
                }
              >
                <TerminalHeaderView
                  summaryType="ready"
                  isActive={isActive}
                  isBackCard={!isActive}
                  stackPosition={isActive ? undefined : pos}
                  nameContent={<TerminalHeaderName label={source.label} lastOscTitle={source.hint} />}
                />
                {isActive && <div className="relative flex-1 flex min-h-0 overflow-hidden">{renderStage(source.key)}</div>}
              </TerminalCardView>
            );
          })}
        </div>
      </div>
      <PlanColumn tasks={tasks} newest={newest} />
    </div>
  );
}

/* ─── Concept 2: command palette ──────────────────────────────────── */

export function ConceptPalette() {
  const [active, setActive] = useState<SourceKey>('agent');
  const { tasks, newest } = useAccumulator(active);

  return (
    <div className="flex gap-6 items-stretch" style={{ height: 520 }}>
      <div
        className="glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel shrink-0 self-start bg-background-secondary"
        style={{ width: 280, boxShadow: 'var(--shadow-panel)' }}
      >
        <label
          className="flex items-center gap-2 h-11 px-4 shrink-0"
          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)' }}
        >
          <Icon name="magnifying-glass" className="w-4 h-4 shrink-0 text-text-tertiary" />
          <input
            readOnly
            placeholder="Start a task…"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
          />
        </label>
        <div className="flex flex-col py-1.5">
          {SOURCES.map((source) => (
            <button
              key={source.key}
              type="button"
              className={`flex items-center gap-2.5 mx-1.5 px-2.5 h-9 rounded-lg border-none text-left transition-colors duration-100 ${
                active === source.key ? 'bg-ink/[0.08] text-text-primary' : 'bg-transparent text-text-secondary hover:bg-ink/[0.04]'
              }`}
              onClick={() => setActive(source.key)}
            >
              <Icon name={source.icon} className="w-4 h-4 shrink-0 opacity-70" />
              <span className="flex-1 min-w-0 truncate text-sm">{source.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-text-tertiary">{source.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <StageFrame>{renderStage(active)}</StageFrame>
      <PlanColumn tasks={tasks} newest={newest} />
    </div>
  );
}

/* ─── Concept 3: pill tabs on one split panel ─────────────────────── */

export function ConceptPills() {
  const [active, setActive] = useState<SourceKey>('agent');
  const { tasks, newest } = useAccumulator(active);

  return (
    <div
      className="glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ height: 520, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <div className="pane-ledge relative z-10 shrink-0 h-12 flex items-center px-3">
        <div className="flex items-center min-w-0 h-7 bg-background-secondary glass-bevel relative border border-bezel rounded-[12px] overflow-hidden">
          {SOURCES.map((source, i) => (
            <div key={source.key} className="flex items-center h-full">
              {i > 0 && <div aria-hidden className="w-px h-3 bg-ink/10" />}
              <button
                type="button"
                className={`h-full px-2.5 flex items-center gap-1.5 border-none font-sans text-[13px] font-medium transition-colors duration-150 ${
                  active === source.key
                    ? 'bg-accent text-accent-ink'
                    : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary'
                }`}
                onClick={() => setActive(source.key)}
              >
                <Icon name={source.icon} className="w-3.5 h-3.5" />
                {source.label}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex overflow-hidden">{renderStage(active)}</div>
        <div className="shrink-0 flex" style={{ width: 300 }}>
          <PlanColumn tasks={tasks} newest={newest} framed={false} />
        </div>
      </div>
    </div>
  );
}

/* ─── Concept 4: scroll-driven steps ──────────────────────────────── */

export function ConceptScroll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SourceKey>('agent');
  const { tasks, newest } = useAccumulator(active);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
      setActive(SOURCES[Math.min(SOURCES.length - 1, Math.floor(progress * SOURCES.length))].key);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const source = sourceByKey(active);
  return (
    <div ref={wrapRef} style={{ height: '280vh' }}>
      <div className="sticky flex flex-col gap-5" style={{ top: 96 }}>
        <div className="flex items-center gap-2.5 text-[15px] text-text-secondary">
          <Icon name={source.icon} className="w-4 h-4 opacity-70" />
          {source.label}
          <span className="flex items-center gap-1.5 ml-2">
            {SOURCES.map((s) => (
              <span
                key={s.key}
                className="rounded-full transition-all duration-200"
                style={{
                  width: s.key === active ? 16 : 5,
                  height: 5,
                  background:
                    s.key === active ? 'var(--color-accent)' : 'color-mix(in srgb, var(--color-ink) 20%, transparent)',
                }}
              />
            ))}
          </span>
        </div>
        <div className="flex gap-6 items-stretch" style={{ height: 500 }}>
          <StageFrame>{renderStage(active)}</StageFrame>
          <PlanColumn tasks={tasks} newest={newest} />
        </div>
      </div>
    </div>
  );
}
