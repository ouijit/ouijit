import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { HookRowView } from '../../ouijit-ui/components/scripts/HookRowView';
import { MockPlanPanel, MockPreviewPanel, getPanelFixtures } from './MockPanels';
import {
  ActiveActions,
  BranchLabel,
  ClaudeBody,
  ClaudeShell,
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  type PanelKind,
} from './stackParts';
import AgentStatesDemo from './AgentStatesDemo';
import AutomationDemo from './AutomationDemo';

/**
 * Build section lab, round 2 — the features on their real surfaces, at full
 * size: panels on the terminal, live statuses, sandboxed terminals, lifecycle
 * hooks, the session-aware CLI.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

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

function MacNotification({ body }: { body: string }) {
  return (
    <div className="macos-notif">
      <img src="/assets/ouijit-app-icon.png" alt="" width={36} height={36} style={{ flexShrink: 0, display: 'block' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.95)', letterSpacing: 0.1 }}>
            Ouijit
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>now</span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2, lineHeight: 1.3 }}>{body}</div>
      </div>
    </div>
  );
}

/* ═══ 2a · Workbench — one real terminal stack, beats open its panels ═══ */

const WORKBENCH_STEPS = [
  { key: 'term', title: 'A terminal per task', body: 'Every task runs in its own worktree, with its own terminals stacked behind one another.' },
  { key: 'plan', title: 'The plan rides along', body: 'plan.md opens as a panel on the terminal. The agent keeps it current while it works.' },
  { key: 'preview', title: 'See it running', body: 'Point a preview panel at the dev server without leaving the task.' },
  { key: 'status', title: 'Look away freely', body: 'Statuses track every agent, and a notification lands the moment one finishes.' },
] as const;

type WorkbenchKey = (typeof WORKBENCH_STEPS)[number]['key'];

interface BackCard {
  ptyId: string;
  label: string;
  oscTitle: string;
  summaryType: string;
  doneTitle?: string;
  sandboxed?: boolean;
}

const WORKBENCH_BACK: BackCard[] = [
  {
    ptyId: 'pty-103-test',
    label: 'Polish invitation email',
    oscTitle: 'Tightening brand tokens...',
    summaryType: 'thinking',
    doneTitle: 'done · 14 passed',
  },
  {
    ptyId: 'pty-105-shell',
    label: 'Audit accessibility on settings dialog',
    oscTitle: 'Investigating contrast at SettingsDialog:121',
    summaryType: 'thinking',
    sandboxed: true,
  },
  {
    ptyId: 'pty-101-dev',
    label: 'Rework onboarding flow',
    oscTitle: 'live dev server',
    summaryType: 'ready',
  },
];

export function VariantWorkbench() {
  const { setRow, progress } = useScrubRows(WORKBENCH_STEPS.map((s) => s.key) as readonly WorkbenchKey[]);
  const fixtures = getPanelFixtures('pty-101-dev');

  const planV = clamp01((progress.plan - 0.45) / 0.22) * (1 - clamp01((progress.preview - 0.35) / 0.22));
  const previewV = clamp01((progress.preview - 0.45) / 0.22) * (1 - clamp01((progress.status - 0.35) / 0.22));
  const st = clamp01((progress.status - 0.45) / 0.25);
  const openPanel: PanelKind | null = previewV > 0.5 ? 'preview' : planV > 0.5 ? 'plan' : null;

  return (
    <div className="bl-split">
      <div className="bl-steps">
        {WORKBENCH_STEPS.map((s) => (
          <div key={s.key} ref={setRow(s.key)} className="bl-step">
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="bl-rail" style={{ width: 780 }}>
        <Desk hue="indigo" style={{ padding: 28, paddingTop: 104 }}>
          <div className="relative" style={{ height: 480 }}>
            {WORKBENCH_BACK.map((card, i) => {
              const finished = card.doneTitle && st > 0.3;
              return (
                <TerminalCardView key={card.ptyId} backDepth={i + 1}>
                  <TerminalHeaderView
                    summaryType={finished ? 'ready' : card.summaryType}
                    sandboxed={card.sandboxed}
                    isBackCard
                    stackPosition={i + 1}
                    nameContent={
                      <TerminalHeaderName label={card.label} lastOscTitle={finished ? card.doneTitle : card.oscTitle} />
                    }
                  />
                </TerminalCardView>
              );
            })}
            <TerminalCardView isActive>
              <TerminalHeaderView
                isActive
                summaryType="thinking"
                nameContent={<TerminalHeaderName label="claude" lastOscTitle="Editing onboarding stepper..." />}
                branchContent={<BranchLabel branch="rework-onboarding" />}
                actions={<ActiveActions fixtures={fixtures} openPanel={openPanel} onToggle={() => {}} />}
              />
              <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
                <ClaudeBody />
                {planV > 0.02 && fixtures.plan && (
                  <div className="absolute inset-0" style={{ opacity: planV, pointerEvents: 'none' }}>
                    <MockPlanPanel fixture={fixtures.plan} onClose={() => {}} />
                  </div>
                )}
                {previewV > 0.02 && fixtures.preview && (
                  <div className="absolute inset-0" style={{ opacity: previewV, pointerEvents: 'none' }}>
                    <MockPreviewPanel fixture={fixtures.preview} onClose={() => {}} />
                  </div>
                )}
              </div>
            </TerminalCardView>
          </div>
          <div
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              width: 270,
              zIndex: 30,
              opacity: st,
              transform: `translateY(${(1 - st) * 14}px)`,
              transition: 'opacity 200ms ease, transform 200ms ease',
              pointerEvents: 'none',
            }}
          >
            <MacNotification body="Polish invitation email — done · 14 passed" />
          </div>
        </Desk>
      </div>
    </div>
  );
}

/* ═══ 2b · Feature stages — one full-width real surface per feature ═══ */

function StageRow({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="plan-v3-row">
      <div className="plan-v3-copy">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="plan-v3-mock">{children}</div>
    </div>
  );
}

/** The app's split view: the session on the left, plan.md open beside it. */
function SplitViewMock() {
  const fixtures = getPanelFixtures('pty-101-claude');
  return (
    <div
      className="glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', height: 480 }}
    >
      <TerminalHeaderView
        isActive
        summaryType="thinking"
        nameContent={<TerminalHeaderName label="claude" lastOscTitle="Editing onboarding stepper..." />}
        branchContent={<BranchLabel branch="rework-onboarding" />}
        actions={<ActiveActions fixtures={fixtures} openPanel="plan" onToggle={() => {}} />}
      />
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ClaudeBody />
        </div>
        <div className="pane-seam relative w-px shrink-0" />
        <div className="relative shrink-0" style={{ width: '44%' }}>
          {fixtures.plan && <MockPlanPanel fixture={fixtures.plan} onClose={() => {}} />}
        </div>
      </div>
    </div>
  );
}

/** A terminal opened in the Lima sandbox, with the Open in menu beside it. */
function SandboxMock() {
  return (
    <div className="relative">
      <div
        className="glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
        style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', height: 400 }}
      >
        <TerminalHeaderView
          isActive
          summaryType="thinking"
          sandboxed
          nameContent={<TerminalHeaderName label="claude (lima)" lastOscTitle="Running the reproduction..." />}
          branchContent={<BranchLabel branch="debug-issue-502" />}
        />
        <ClaudeShell busy>
          <ClaudeUser>Reproduce the crash from issue #502 — the report includes a script, run it and find the cause.</ClaudeUser>
          <AssistantSay>Running it in this sandbox first, then reading the stack.</AssistantSay>
          <ToolCall name="Bash" args="npm install && node repro-502.js" />
          <ToolResult>
            <span className="text-white/55">added 412 packages</span>
            <span className="mx-1.5 text-white/30">·</span>
            <span className="text-[#f85149]">TypeError: Cannot read properties of null</span>
          </ToolResult>
          <ToolCall name="Read" args="src/export/csvWriter.ts" />
          <ToolResult>Read 96 lines</ToolResult>
          <AssistantSay>
            <span className="italic text-white/55">The stream closes before flush — checking the writer&hellip;</span>
          </AssistantSay>
        </ClaudeShell>
      </div>
      <div
        className="glass-bevel rounded-[12px] border border-bezel-panel overflow-hidden"
        style={{
          position: 'absolute',
          top: 52,
          right: -36,
          width: 210,
          zIndex: 10,
          background: '#212126',
          boxShadow: 'var(--shadow-panel), 0 24px 48px -12px rgba(0,0,0,0.65)',
        }}
      >
        <div className="px-3 pt-2 pb-1 text-[11px] text-text-tertiary">Open in</div>
        <div className="pb-1.5 text-[13px]">
          <div className="px-3 py-1.5 text-text-secondary">Terminal</div>
          <div className="px-3 py-1.5 bg-accent text-accent-ink flex items-center justify-between">
            <span>Lima VM sandbox</span>
            <Icon name="check" className="w-3.5 h-3.5" />
          </div>
          <div className="px-3 py-1.5 text-text-secondary">nono sandbox</div>
        </div>
      </div>
    </div>
  );
}

/** The agent files subtasks and moves its own task over the session CLI. */
function CliMock() {
  return (
    <div
      className="glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)', height: 420 }}
    >
      <TerminalHeaderView
        isActive
        summaryType="ready"
        nameContent={<TerminalHeaderName label="claude" lastOscTitle="Ready for review" />}
        branchContent={<BranchLabel branch="migrate-react-19" />}
      />
      <ClaudeShell pendingText="merge it once CI is green">
        <ClaudeUser>Split the remaining migration work into subtasks, then send this one to review.</ClaudeUser>
        <ToolCall name="Bash" args={'ouijit task create "Update Suspense boundaries"'} />
        <ToolResult>
          Created task <span className="text-white/85">#143</span>
        </ToolResult>
        <ToolCall name="Bash" args={'ouijit task create "Audit useTransition usages"'} />
        <ToolResult>
          Created task <span className="text-white/85">#144</span>
        </ToolResult>
        <ToolCall name="Bash" args="ouijit task set-status 142 in_review" />
        <ToolResult>
          #142 <span className="text-white/65">in_progress → in_review</span>
        </ToolResult>
        <AssistantSay>
          <span>Ready for review.</span>
          <span className="ml-1 text-white/55">Two subtasks queued for the next agents.</span>
        </AssistantSay>
      </ClaudeShell>
    </div>
  );
}

const HOOKS = [
  { label: 'Start', description: 'Task moves from To Do to In Progress', command: 'claude "$OUIJIT_TASK_DESCRIPTION"' },
  { label: 'Continue', description: 'Reopening a task already In Progress', command: 'claude --continue' },
  { label: 'Run', description: 'The Run button or a runner panel opens', command: 'npm run dev' },
  { label: 'Review', description: 'Task moves to In Review', command: 'gh pr create --fill' },
  { label: 'Done', description: 'Task moves to Done', command: 'git push origin HEAD' },
];

function HooksMock() {
  return (
    <div
      className="glass-bevel relative flex flex-col rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center gap-2 px-4">
        <Icon name="webhooks-logo" className="w-4 h-4 text-ink/50" />
        <span className="text-[13px] text-ink/70">Hooks</span>
        <span className="ml-auto font-mono text-[11px] text-ink/35">Project Settings</span>
      </div>
      <div className="divide-y divide-white/[0.06] py-1">
        {HOOKS.map((h) => (
          <HookRowView key={h.label} label={h.label} description={h.description} command={h.command} />
        ))}
      </div>
    </div>
  );
}

export function VariantStages() {
  return (
    <div className="flex flex-col" style={{ gap: 140 }}>
      <StageRow
        title="Terminal and plan, side by side"
        body="plan.md opens as a panel on the terminal — split the view and the agent's plan stays in sight while it works."
      >
        <Desk hue="indigo" style={{ padding: 32 }}>
          <SplitViewMock />
        </Desk>
      </StageRow>
      <StageRow
        title="Every agent, at a glance"
        body="Thinking, ready, waiting on you — the status column reads live, and a notification lands when a turn ends."
      >
        <Desk hue="teal" style={{ padding: 32 }}>
          <AgentStatesDemo />
        </Desk>
      </StageRow>
      <StageRow
        title="Contain untrusted code"
        body="Open any terminal in a Lima VM or under nono. The outlined dot marks the ones that are contained."
      >
        <Desk hue="rose" style={{ padding: 32, paddingRight: 60, overflow: 'visible' }}>
          <SandboxMock />
        </Desk>
      </StageRow>
      <StageRow
        title="Hooks on every move"
        body="Five lifecycle hooks run your commands as tasks change status — launch the agent, boot the dev server, file the PR."
      >
        <Desk hue="graphite" style={{ padding: 32 }}>
          <AutomationDemo />
        </Desk>
      </StageRow>
      <StageRow
        title="Agents drive the board"
        body="The CLI is session-aware: agents file subtasks and move their own task, no extra setup."
      >
        <Desk hue="indigo" style={{ padding: 32 }}>
          <CliMock />
        </Desk>
      </StageRow>
    </div>
  );
}

/* ═══ 2c · Bento — every Build feature dense, in one grid ═══ */

function BentoStatusList() {
  const rows = [
    { label: 'claude', summary: 'thinking…', type: 'thinking' },
    { label: 'codex', summary: 'awaiting input', type: 'ready' },
    { label: 'claude (sandbox)', summary: 'editing files', type: 'thinking', sandboxed: true },
    { label: 'pi', summary: 'done · lint clean', type: 'ready' },
  ];
  return (
    <div className="divide-y divide-white/[0.06] rounded-[12px] border border-bezel-panel overflow-hidden" style={{ background: 'var(--color-terminal-bg)' }}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 px-3 py-2">
          <StatusDot summaryType={r.type} sandboxed={r.sandboxed} />
          <span className="font-mono text-xs font-medium text-ink/85">{r.label}</span>
          <span className="font-mono text-xs text-ink/45 truncate">— {r.summary}</span>
        </div>
      ))}
    </div>
  );
}

export function VariantBento() {
  const fixtures = getPanelFixtures('pty-101-claude');
  return (
    <div className="details-grid bento">
      <div className="detail detail-span-4">
        <div className="detail-title">The loaded terminal.</div>
        <p>plan.md, the live preview, and the diff ride the terminal as panels.</p>
        <div
          className="glass-bevel relative flex flex-col rounded-[12px] overflow-hidden border border-bezel-panel mt-3"
          style={{ background: 'var(--color-terminal-bg)', height: 300 }}
        >
          <TerminalHeaderView
            isActive
            summaryType="thinking"
            nameContent={<TerminalHeaderName label="claude" />}
            actions={<ActiveActions fixtures={fixtures} openPanel="plan" onToggle={() => {}} />}
          />
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <ClaudeBody />
            </div>
            <div className="pane-seam relative w-px shrink-0" />
            <div className="relative shrink-0" style={{ width: '46%' }}>
              {fixtures.plan && <MockPlanPanel fixture={fixtures.plan} onClose={() => {}} />}
            </div>
          </div>
        </div>
      </div>
      <div className="detail detail-span-2">
        <div className="detail-title">Every agent, at a glance.</div>
        <p>Statuses read live across all terminals.</p>
        <div className="mt-3">
          <BentoStatusList />
        </div>
      </div>
      <div className="detail detail-span-2">
        <div className="detail-title">Untrusted code, contained.</div>
        <p>A Lima VM mounting only the task's files, or nono in place.</p>
        <div className="mt-3 rounded-[12px] border border-bezel-panel overflow-hidden text-[13px]" style={{ background: 'var(--color-terminal-bg)' }}>
          <div className="px-3 pt-2 pb-1 text-[11px] text-text-tertiary">Open in</div>
          <div className="pb-1">
            <div className="px-3 py-1.5 text-text-secondary">Terminal</div>
            <div className="px-3 py-1.5 bg-accent text-accent-ink flex items-center justify-between">
              <span>Lima VM sandbox</span>
              <Icon name="check" className="w-3.5 h-3.5" />
            </div>
            <div className="px-3 py-1.5 text-text-secondary">nono sandbox</div>
          </div>
        </div>
      </div>
      <div className="detail detail-span-2">
        <div className="detail-title">Hooks on every move.</div>
        <p>Lifecycle hooks run your commands as tasks change status.</p>
        <div className="mt-3 rounded-[12px] border border-bezel-panel overflow-hidden" style={{ background: 'var(--color-terminal-bg)' }}>
          <div className="divide-y divide-white/[0.06]">
            {HOOKS.slice(0, 3).map((h) => (
              <HookRowView key={h.label} label={h.label} description="" command={h.command} actionLabel=" " />
            ))}
          </div>
        </div>
      </div>
      <div className="detail detail-span-2">
        <div className="detail-title">Agents drive the board.</div>
        <p>The CLI is session-aware inside every terminal.</p>
        <div className="mt-3 rounded-[12px] border border-bezel-panel px-3 py-2.5 font-mono text-[11px] leading-[1.8]" style={{ background: 'var(--color-terminal-bg)' }}>
          <div className="text-white/80">
            <span className="text-white/40">$</span> ouijit task set-status 142 in_review
          </div>
          <div className="text-white/50">
            #142 <span className="text-white/65">in_progress → in_review</span>
          </div>
        </div>
      </div>
      <div className="detail detail-span-2">
        <div className="detail-title">Know when it's done.</div>
        <p>A notification lands when an agent's turn ends.</p>
        <div className="mt-3">
          <MacNotification body="Rework onboarding flow — done · 14 passed" />
        </div>
      </div>
    </div>
  );
}

/* ═══ 2d · Carousel — features as full-size cards on a horizontal rail ═══ */

function CarouselCard({
  hue,
  title,
  body,
  wide = false,
  children,
}: {
  hue: keyof typeof DESK_HUES;
  title: string;
  body: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="bl-carousel-card" style={{ flexBasis: wide ? 860 : 700 }}>
      <Desk hue={hue} style={{ padding: 32, height: '100%' }}>
        <div className="bl-carousel-copy">
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
        {children}
      </Desk>
    </div>
  );
}

export function VariantCarousel() {
  return (
    <div className="bl-carousel">
      <CarouselCard
        hue="indigo"
        wide
        title="Terminal and plan, side by side"
        body="plan.md rides the terminal as a panel; the agent keeps it current."
      >
        <SplitViewMock />
      </CarouselCard>
      <CarouselCard
        hue="teal"
        title="Every agent, at a glance"
        body="Statuses read live, and a notification lands when a turn ends."
      >
        <AgentStatesDemo />
      </CarouselCard>
      <CarouselCard
        hue="rose"
        title="Contain untrusted code"
        body="Open any terminal in a Lima VM or under nono."
      >
        <SandboxMock />
      </CarouselCard>
      <CarouselCard
        hue="graphite"
        title="Hooks on every move"
        body="Lifecycle hooks run your commands as tasks change status."
      >
        <AutomationDemo />
      </CarouselCard>
      <CarouselCard
        hue="indigo"
        title="Agents drive the board"
        body="The session-aware CLI files subtasks and statuses from inside the work."
      >
        <CliMock />
      </CarouselCard>
    </div>
  );
}

/* ═══ 2e · Annotated scene — one workspace, callouts naming its parts ═══ */

function Callout({
  top,
  side,
  reach,
  label,
}: {
  top: number;
  side: 'left' | 'right';
  /** Length of the connector line toward the target. */
  reach: number;
  label: string;
}) {
  return (
    <div
      className="bl-callout"
      style={{ position: 'absolute', top, [side]: 0, flexDirection: side === 'left' ? 'row' : 'row-reverse' }}
    >
      <span className="bl-callout-label">{label}</span>
      <span className="bl-callout-line" style={{ width: reach }} />
      <span className="bl-callout-dot" />
    </div>
  );
}

export function VariantScene() {
  const fixtures = getPanelFixtures('pty-101-claude');
  return (
    <Desk hue="graphite" style={{ padding: '96px 0 48px', overflow: 'visible' }}>
      <div className="relative mx-auto" style={{ width: 720, height: 500 }}>
        <TerminalCardView backDepth={2}>
          <TerminalHeaderView
            summaryType="ready"
            isBackCard
            stackPosition={2}
            nameContent={<TerminalHeaderName label="Polish invitation email" lastOscTitle="done · 14 passed" />}
          />
        </TerminalCardView>
        <TerminalCardView backDepth={1}>
          <TerminalHeaderView
            summaryType="thinking"
            sandboxed
            isBackCard
            stackPosition={1}
            nameContent={
              <TerminalHeaderName label="Audit accessibility on settings dialog" lastOscTitle="running axe (lima)" />
            }
          />
        </TerminalCardView>
        <TerminalCardView isActive>
          <TerminalHeaderView
            isActive
            summaryType="thinking"
            nameContent={<TerminalHeaderName label="claude" lastOscTitle="Editing onboarding stepper..." />}
            branchContent={<BranchLabel branch="rework-onboarding" />}
            actions={<ActiveActions fixtures={fixtures} openPanel="plan" onToggle={() => {}} />}
          />
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <ClaudeBody />
            </div>
            <div className="pane-seam relative w-px shrink-0" />
            <div className="relative shrink-0" style={{ width: '42%' }}>
              {fixtures.plan && <MockPlanPanel fixture={fixtures.plan} onClose={() => {}} />}
            </div>
          </div>
        </TerminalCardView>
      </div>
      <Callout top={118} side="left" reach={120} label="Live status per agent" />
      <Callout top={330} side="left" reach={96} label="The agent's session" />
      <Callout top={80} side="left" reach={116} label="A sandboxed terminal" />
      <Callout top={118} side="right" reach={26} label="Panels on the terminal" />
      <Callout top={300} side="right" reach={26} label="plan.md, kept current" />
    </Desk>
  );
}

/* ═══ 2f · Monolith — full-bleed surfaces, one-line captions ═══ */

function MonoBlock({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="bl-mono-block">
      <div className="bl-mono-copy">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      {children}
    </div>
  );
}

export function VariantMonolith() {
  return (
    <div className="flex flex-col" style={{ gap: 120 }}>
      <MonoBlock
        title="The plan stays in sight"
        body="plan.md opens as a panel on the terminal, split beside the session."
      >
        <SplitViewMock />
      </MonoBlock>
      <MonoBlock title="Every agent, at a glance" body="Statuses read live across the whole stack.">
        <AgentStatesDemo />
      </MonoBlock>
      <MonoBlock
        title="Contain untrusted code"
        body="A Lima VM that mounts only the task's files, or nono in place."
      >
        <SandboxMock />
      </MonoBlock>
      <div className="bl-mono-pair">
        <MonoBlock title="Hooks on every move" body="Your commands run as tasks change status.">
          <HooksMock />
        </MonoBlock>
        <MonoBlock title="Agents drive the board" body="The CLI is session-aware in every terminal.">
          <CliMock />
        </MonoBlock>
      </div>
    </div>
  );
}
