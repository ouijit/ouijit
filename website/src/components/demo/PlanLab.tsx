import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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

/** Plays the landing sequence once, the first time `ref` scrolls into view. */
function useChoreoOnVisible(ref: RefObject<HTMLElement | null>): Choreo {
  const [added, setAdded] = useState<SourceKey[]>([]);
  const [firing, setFiring] = useState<SourceKey | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((e) => e.isIntersecting)) return;
        started = true;
        observer.disconnect();
        void (async () => {
          await sleep(500);
          for (const key of SEQUENCE) {
            if (!alive) return;
            setFiring(key);
            await sleep(450);
            if (!alive) return;
            setAdded((prev) => [...prev, key]);
            await sleep(950);
          }
          setFiring(null);
        })();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [ref]);
  return {
    tasks: toTasks(added),
    newest: added.length > 0 ? TASK_BY_SOURCE[added[added.length - 1]].taskNumber : null,
    firing,
  };
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

/* ─── Variant 1: annotated diorama, plays once on view ────────────── */

export function VariantAnnotated() {
  const ref = useRef<HTMLDivElement>(null);
  const choreo = useChoreoOnVisible(ref);
  return (
    <div ref={ref} className="plan-v1">
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <p className="plan-v-sub">
        Agents, GitHub issues, and your own two hands all feed the same board — and every task carries its plan.
      </p>
      <div className="flex gap-5 items-stretch" style={{ height: 540, marginTop: 56 }}>
        <figure className="plan-v1-fig" style={{ flex: '1.15 1 0' }}>
          <figcaption>An agent breaks down the epic</figcaption>
          <Panel firing={choreo.firing === 'agent'} className="flex-1" ledge={ledge('terminal', 'claude', 'ouijit task create')}>
            <AgentPane />
          </Panel>
        </figure>
        <div className="flex flex-col gap-5 min-w-0" style={{ flex: '1 1 0' }}>
          <figure className="plan-v1-fig shrink-0">
            <figcaption>Issues become tasks</figcaption>
            <Panel firing={choreo.firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
              <IssuePane />
            </Panel>
          </figure>
          <figure className="plan-v1-fig flex-1 min-h-0">
            <figcaption>The detail rides in plan.md</figcaption>
            <Panel className="flex-1" ledge={ledge('file-text', 'plan.md')}>
              <PlanPane short />
            </Panel>
          </figure>
        </div>
        <figure className="plan-v1-fig shrink-0" style={{ width: 300 }}>
          <figcaption>…or type one straight in</figcaption>
          <PlanColumn choreo={choreo} framed width={300} />
        </figure>
      </div>
    </div>
  );
}

/* ─── Variant 1b: staggered diorama, captions below ───────────────── */

export function VariantAnnotatedStaggered() {
  const ref = useRef<HTMLDivElement>(null);
  const choreo = useChoreoOnVisible(ref);
  return (
    <div ref={ref}>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <p className="plan-v-sub">
        Agents, GitHub issues, and your own two hands all feed the same board — and every task carries its plan.
      </p>
      <div className="flex gap-6 items-start" style={{ height: 660, marginTop: 64 }}>
        <figure className="plan-v1-fig captions-below" style={{ flex: '1.15 1 0', marginTop: 48, height: 500 }}>
          <Panel firing={choreo.firing === 'agent'} className="flex-1" ledge={ledge('terminal', 'claude', 'ouijit task create')}>
            <AgentPane />
          </Panel>
          <figcaption>An agent breaks down the epic</figcaption>
        </figure>
        <div className="flex flex-col gap-6 min-w-0" style={{ flex: '1 1 0', marginTop: 110 }}>
          <figure className="plan-v1-fig captions-below shrink-0">
            <Panel firing={choreo.firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
              <IssuePane />
            </Panel>
            <figcaption>Issues become tasks</figcaption>
          </figure>
          <figure className="plan-v1-fig captions-below shrink-0" style={{ height: 280 }}>
            <Panel className="flex-1" ledge={ledge('file-text', 'plan.md')}>
              <PlanPane short />
            </Panel>
            <figcaption>The detail rides in plan.md</figcaption>
          </figure>
        </div>
        <figure className="plan-v1-fig captions-below shrink-0" style={{ width: 300, height: 560 }}>
          <div className="flex flex-1 min-h-0">
            <PlanColumn choreo={choreo} framed width={300} />
          </div>
          <figcaption>…or type one straight in</figcaption>
        </figure>
      </div>
    </div>
  );
}

/* ─── Variant 1c: the board centered between its sources ──────────── */

export function VariantAnnotatedCentered() {
  const ref = useRef<HTMLDivElement>(null);
  const choreo = useChoreoOnVisible(ref);
  return (
    <div ref={ref}>
      <h2 className="plan-v-headline">Plan at scale, in detail</h2>
      <p className="plan-v-sub">
        Agents, GitHub issues, and your own two hands all feed the same board — and every task carries its plan.
      </p>
      <div className="flex gap-6 items-stretch" style={{ height: 540, marginTop: 56 }}>
        <figure className="plan-v1-fig" style={{ flex: '1 1 0' }}>
          <figcaption>An agent breaks down the epic</figcaption>
          <Panel firing={choreo.firing === 'agent'} className="flex-1" ledge={ledge('terminal', 'claude', 'ouijit task create')}>
            <AgentPane />
          </Panel>
        </figure>
        <figure className="plan-v1-fig shrink-0" style={{ width: 300 }}>
          <figcaption>Everything lands on the board</figcaption>
          <div className="flex flex-1 min-h-0">
            <PlanColumn choreo={choreo} framed width={300} />
          </div>
        </figure>
        <div className="flex flex-col gap-6 min-w-0" style={{ flex: '1 1 0' }}>
          <figure className="plan-v1-fig shrink-0">
            <figcaption>Issues become tasks</figcaption>
            <Panel firing={choreo.firing === 'issue'} ledge={ledge('github-logo', 'Issues')}>
              <IssuePane />
            </Panel>
          </figure>
          <figure className="plan-v1-fig flex-1 min-h-0">
            <figcaption>The detail rides in plan.md</figcaption>
            <Panel className="flex-1" ledge={ledge('file-text', 'plan.md')}>
              <PlanPane short />
            </Panel>
          </figure>
        </div>
      </div>
    </div>
  );
}

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
