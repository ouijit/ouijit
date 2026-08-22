import { useEffect, useState, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { ClaudeUser, AssistantSay, ToolCall, ToolResult, BODY_CLS } from './stackParts';

/**
 * Concept lab for the Plan section, round two: no switchers — every source is
 * on stage at once, and a staggered choreography lands each card in the To Do
 * column. Three arrangements to evaluate at /c/plan-lab/.
 */

type SourceKey = 'agent' | 'manual' | 'issue';

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

/** Card landings staggered on mount; `firing` marks the source mid-landing. */
const SEQUENCE: SourceKey[] = ['agent', 'issue', 'manual'];

function useChoreography() {
  const [added, setAdded] = useState<SourceKey[]>([]);
  const [firing, setFiring] = useState<SourceKey | null>(null);
  useEffect(() => {
    const timers = SEQUENCE.flatMap((key, i) => [
      setTimeout(() => setFiring(key), 900 + i * 1400),
      setTimeout(() => setAdded((prev) => (prev.includes(key) ? prev : [...prev, key])), 1300 + i * 1400),
    ]);
    timers.push(setTimeout(() => setFiring(null), 900 + SEQUENCE.length * 1400));
    return () => timers.forEach(clearTimeout);
  }, []);
  const tasks = [...added.map((key) => TASK_BY_SOURCE[key]).reverse(), SEED_TASK];
  return { tasks, newest: added.length > 0 ? TASK_BY_SOURCE[added[added.length - 1]].taskNumber : null, firing };
}

/* ─── The column, composer in its real home ───────────────────────── */

function ComposerFooter({ firing }: { firing: boolean }) {
  return (
    <div className={`kanban-add-form ${firing ? 'plan-lab-firing' : ''}`}>
      <input
        readOnly
        value="Fix flaky signup e2e"
        className="kanban-add-input w-full text-[15px] text-text-primary bg-transparent px-3 py-3 outline-none border-none"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
      />
      <textarea
        readOnly
        rows={2}
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
  );
}

function PlanColumn({
  tasks,
  newest,
  firing,
  framed = true,
  width = 300,
}: {
  tasks: TaskWithWorkspace[];
  newest: number | null;
  firing: SourceKey | null;
  framed?: boolean;
  width?: number;
}) {
  const column = (
    <KanbanColumnView
      status="todo"
      label="To Do"
      count={tasks.length}
      footer={<ComposerFooter firing={firing === 'manual'} />}
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

/* ─── Source panes ────────────────────────────────────────────────── */

function AgentPane() {
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

function IssuePane() {
  return (
    <div className="w-full my-auto flex flex-col py-3">
      <div className="px-4 pb-1 text-[13px] text-text-tertiary">Open</div>
      <div className="relative w-full px-4 py-2 flex flex-col gap-0.5 bg-ink/[0.07]">
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

function PlanPane() {
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
          <li>
            <input type="checkbox" readOnly /> Document the limits in <code>docs/api.md</code>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** A labeled panel: pane-ledge header naming the source, body below. */
function SourcePanel({
  icon,
  label,
  hint,
  firing = false,
  className = '',
  children,
}: {
  icon: string;
  label: string;
  hint?: string;
  firing?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel min-h-0 ${
        firing ? 'plan-lab-firing' : ''
      } ${className}`}
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">
        <Icon name={icon} className="w-4 h-4 text-ink/50" />
        <span className="text-[13px] text-ink/70">{label}</span>
        {hint && <span className="ml-auto font-mono text-[11px] text-ink/35">{hint}</span>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/* ─── Arrangement A: mosaic left, column right ────────────────────── */

export function ArrangeMosaic() {
  const { tasks, newest, firing } = useChoreography();
  return (
    <div className="flex gap-5 items-stretch" style={{ height: 560 }}>
      <div className="flex-1 min-w-0 grid gap-5" style={{ gridTemplateColumns: '1.2fr 1fr', gridTemplateRows: '1fr 1.1fr' }}>
        <SourcePanel icon="terminal" label="claude" hint="ouijit task create" firing={firing === 'agent'} className="row-span-2">
          <AgentPane />
        </SourcePanel>
        <SourcePanel icon="github-logo" label="Issues" hint="#491" firing={firing === 'issue'}>
          <IssuePane />
        </SourcePanel>
        <SourcePanel icon="file-text" label="plan.md" firing={false}>
          <PlanPane />
        </SourcePanel>
      </div>
      <PlanColumn tasks={tasks} newest={newest} firing={firing} />
    </div>
  );
}

/* ─── Arrangement B: column center, sources flank ─────────────────── */

export function ArrangeFlanked() {
  const { tasks, newest, firing } = useChoreography();
  return (
    <div className="flex gap-5 items-stretch" style={{ height: 560 }}>
      <div className="flex-1 min-w-0 flex flex-col gap-5">
        <SourcePanel icon="terminal" label="claude" hint="ouijit task create" firing={firing === 'agent'} className="flex-1">
          <AgentPane />
        </SourcePanel>
        <SourcePanel icon="github-logo" label="Issues" hint="#491" firing={firing === 'issue'} className="shrink-0">
          <IssuePane />
        </SourcePanel>
      </div>
      <PlanColumn tasks={tasks} newest={newest} firing={firing} width={310} />
      <div className="flex-1 min-w-0 flex flex-col">
        <SourcePanel icon="file-text" label="plan.md" className="flex-1">
          <PlanPane />
        </SourcePanel>
      </div>
    </div>
  );
}

/* ─── Arrangement C: one seamed panel ─────────────────────────────── */

export function ArrangeSeamed() {
  const { tasks, newest, firing } = useChoreography();
  return (
    <div
      className="glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ height: 560, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <div className={`flex-1 min-w-0 flex flex-col ${firing === 'agent' ? 'plan-lab-firing-flat' : ''}`}>
        <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">
          <Icon name="terminal" className="w-4 h-4 text-ink/50" />
          <span className="text-[13px] text-ink/70">claude</span>
          <span className="ml-auto font-mono text-[11px] text-ink/35">ouijit task create</span>
        </div>
        <AgentPane />
      </div>
      <div className="pane-seam relative w-px shrink-0" />
      <div className="flex flex-col min-w-0" style={{ flexBasis: '30%' }}>
        <div className={`flex flex-col flex-1 min-h-0 ${firing === 'issue' ? 'plan-lab-firing-flat' : ''}`}>
          <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">
            <Icon name="github-logo" className="w-4 h-4 text-ink/50" />
            <span className="text-[13px] text-ink/70">Issues</span>
          </div>
          <IssuePane />
        </div>
        <div className="flex flex-col flex-1 min-h-0" style={{ boxShadow: '0 -1px 0 var(--seam-cut), 0 -2px 0 var(--seam-catch)' }}>
          <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">
            <Icon name="file-text" className="w-4 h-4 text-ink/50" />
            <span className="text-[13px] text-ink/70 font-mono">plan.md</span>
          </div>
          <PlanPane />
        </div>
      </div>
      <div className="pane-seam relative w-px shrink-0" />
      <div className="shrink-0 flex" style={{ width: 300 }}>
        <PlanColumn tasks={tasks} newest={newest} firing={firing} framed={false} />
      </div>
    </div>
  );
}
