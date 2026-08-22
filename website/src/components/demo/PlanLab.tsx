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
  return [...added.map((key) => TASK_BY_SOURCE[key]).reverse(), SEED_TASK];
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

function ComposerFooter({ firing }: { firing: boolean }) {
  return (
    <div className={`kanban-add-form ${firing ? 'plan-lab-firing' : ''}`}>
      <input
        readOnly
        value="Fix flaky signup e2e"
        className="kanban-add-input w-full text-[15px] text-text-primary bg-transparent px-3 py-3 outline-none border-none"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
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

function AgentPane({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${BODY_CLS} !p-5`}>
      <ClaudeUser>break the API hardening epic into tasks on the board</ClaudeUser>
      <AssistantSay>Rate limiting first — it blocks the other two. Creating it.</AssistantSay>
      <ToolCall
        name="Bash"
        args={'ouijit task create "Add rate-limit headers to the public API"\n       --prompt "429 + Retry-After on every public route"'}
      />
      <ToolResult>{'{"success": true, "task": {"taskNumber": 119}}'}</ToolResult>
      {!compact && <AssistantSay>Created T-119. Two more to go.</AssistantSay>}
    </div>
  );
}

function IssuePane({ single = false }: { single?: boolean }) {
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

/** Same trigger, copy stacked above the mock — for the narrower layouts. */
function StoryCard({
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
    <div ref={ref} className="plan-v3-stacked">
      <div className="plan-v3-copy !w-auto">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="plan-v3-mock">{children}</div>
    </div>
  );
}

export function VariantStory() {
  const { choreo, firing, land } = useStoryChoreo();
  return (
    <div className="plan-v3">
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <div className="flex gap-10 items-start" style={{ marginTop: 64 }}>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 96 }}>
          <StoryRow
            title="Delegate the breakdown"
            body="An agent splits the epic and files each task over the CLI, prompt and all."
            onVisible={() => land('agent')}
          >
            <Panel firing={firing === 'agent'} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
              <AgentPane />
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
              <PlanPane />
            </Panel>
          </StoryRow>
        </div>
        <div className="shrink-0 sticky" style={{ top: 120, width: 300 }}>
          <div className="flex" style={{ height: 480 }}>
            <PlanColumn choreo={choreo} framed width={300} composer={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Variant 3b: sticky column center, rows on both sides ────────── */

export function VariantStoryCenter() {
  const { choreo, firing, land } = useStoryChoreo();
  return (
    <div>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <div className="flex gap-10 items-start" style={{ marginTop: 72 }}>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 200 }}>
          <StoryCard
            title="Delegate the breakdown"
            body="An agent splits the epic and files each task over the CLI, prompt and all."
            onVisible={() => land('agent')}
          >
            <Panel firing={firing === 'agent'} style={{ height: 300 }} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
              <AgentPane compact />
            </Panel>
          </StoryCard>
          <StoryCard
            title="Or just type"
            body="The composer sits at the bottom of the column, one ⌘N away."
            onVisible={() => land('manual')}
          >
            <Panel firing={firing === 'manual'}>
              <div className="p-5">
                <ComposerFooter firing={false} />
              </div>
            </Panel>
          </StoryCard>
        </div>
        <div className="shrink-0 sticky" style={{ top: 140, width: 300 }}>
          <div className="flex" style={{ height: 480 }}>
            <PlanColumn choreo={choreo} framed width={300} composer={false} />
          </div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 200, paddingTop: 260 }}>
          <StoryCard
            title="Pull from GitHub"
            body="An open issue becomes a task on the board with one click."
            onVisible={() => land('issue')}
          >
            <Panel firing={firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
              <IssuePane single />
            </Panel>
          </StoryCard>
          <StoryCard title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
            <Panel ledge={ledge('file-text', 'plan.md')}>
              <PlanPane short />
            </Panel>
          </StoryCard>
        </div>
      </div>
    </div>
  );
}

/* ─── Variant 3c: sticky column left, sub-section scale rows ──────── */

export function VariantStoryLarge() {
  const { choreo, firing, land } = useStoryChoreo();
  return (
    <div className="plan-v3c">
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <div className="flex gap-14 items-start" style={{ marginTop: 72 }}>
        <div className="shrink-0 sticky" style={{ top: 140, width: 300 }}>
          <div className="flex" style={{ height: 500 }}>
            <PlanColumn choreo={choreo} framed width={300} composer={false} />
          </div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 150 }}>
          <StoryCard
            title="Delegate the breakdown"
            body="An agent splits the epic and files each task over the CLI, prompt and all."
            onVisible={() => land('agent')}
          >
            <Panel firing={firing === 'agent'} style={{ height: 340 }} ledge={ledge('terminal', 'claude', 'ouijit task create')}>
              <AgentPane />
            </Panel>
          </StoryCard>
          <StoryCard
            title="Pull from GitHub"
            body="An open issue becomes a task on the board with one click."
            onVisible={() => land('issue')}
          >
            <Panel firing={firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
              <IssuePane />
            </Panel>
          </StoryCard>
          <StoryCard
            title="Or just type"
            body="The composer sits at the bottom of the column, one ⌘N away."
            onVisible={() => land('manual')}
          >
            <Panel firing={firing === 'manual'}>
              <div className="p-5 max-w-[420px]">
                <ComposerFooter firing={false} />
              </div>
            </Panel>
          </StoryCard>
          <StoryCard title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
            <Panel ledge={ledge('file-text', 'plan.md')}>
              <PlanPane />
            </Panel>
          </StoryCard>
        </div>
      </div>
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

function Well({ className = '', crop = false, children }: { className?: string; crop?: boolean; children: ReactNode }) {
  return (
    <div className={`plan-well ${crop ? 'plan-well-crop' : ''} ${className}`}>
      {crop ? <div style={{ marginRight: -56, marginBottom: -40 }}>{children}</div> : children}
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
            <Well crop>
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
            <Well crop>
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
            <Well crop>
              <Panel firing={firing === 'manual'}>
                <div className="p-5">
                  <ComposerFooter firing={false} />
                </div>
              </Panel>
            </Well>
          </StoryRow>
          <StoryRow title="Keep the detail close" body="Steps, notes, and checkboxes live in each task's plan.md.">
            <Well crop>
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
