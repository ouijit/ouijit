import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { HookRowView } from '../../ouijit-ui/components/scripts/HookRowView';
import { MockPlanPanel, MockPreviewPanel, getPanelFixtures, type PanelFixtures } from './MockPanels';
import {
  ActiveActions,
  BranchLabel,
  ClaudeShell,
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  Continuation,
  DevServerBody,
  type PanelKind,
} from './stackParts';

/**
 * Build section lab, round 4 — the 3b direction as a full section candidate:
 * headline, the four-beat workbench stack (with the dev-terminal promotion
 * carrying the preview), and the sandbox/hooks/CLI strip below.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const DESK_INDIGO =
  'radial-gradient(120% 140% at 15% 0%, rgba(99, 102, 241, 0.32), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(56, 189, 248, 0.14), transparent 55%), linear-gradient(180deg, #191a2e, #121218)';

function useScrubRows(keys: readonly string[]) {
  const rowEls = useRef<Record<string, HTMLElement | null>>({});
  const [progress, setProgress] = useState<Record<string, number>>(
    () => Object.fromEntries(keys.map((k) => [k, 0])),
  );
  const sig = useRef('');
  const keysRef = useRef(keys);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight;
      const next: Record<string, number> = {};
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

  const setRow = (key: string) => (el: HTMLElement | null) => void (rowEls.current[key] = el);
  return { setRow, progress };
}

/** A session line that fades in as its beat's progress passes `at`. */
function Line({ p, at, children }: { p: number; at: number; children: ReactNode }) {
  const v = clamp01((p - at) / 0.08);
  if (v <= 0) return null;
  return <div style={{ opacity: v, transform: `translateY(${(1 - v) * 4}px)` }}>{children}</div>;
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

/* ─── The workbench ───────────────────────────────────────────────── */

const BEATS = [
  {
    key: 'term',
    title: 'A terminal per task',
    body: 'Every task runs in its own worktree; the start hook launches your agent with the task’s prompt.',
  },
  {
    key: 'plan',
    title: 'The plan rides along',
    body: 'plan.md opens as a panel on the terminal. The agent keeps it current while it works.',
  },
  {
    key: 'preview',
    title: 'See it running',
    body: 'The dev server runs one ⌘-tap behind, with a preview panel pointed at it.',
  },
  {
    key: 'status',
    title: 'Look away freely',
    body: 'Statuses track every terminal, and a notification lands the moment one finishes.',
  },
] as const;

/** The active claude session, growing across all four beats: opened by the
 * start hook, writing plan.md as the plan beat arrives, and still working
 * while the viewer is on the preview and status beats. */
function WorkbenchSession({ p }: { p: (k: string) => number }) {
  return (
    <ClaudeShell busy>
      <Line p={p('term')} at={0.25}>
        <div className="text-white/45">
          <span className="text-white/30">$</span> claude "$OUIJIT_TASK_DESCRIPTION"
        </div>
      </Line>
      <Line p={p('term')} at={0.4}>
        <ClaudeUser>Split onboarding into a three-step stepper with saved progress.</ClaudeUser>
      </Line>
      <Line p={p('term')} at={0.55}>
        <AssistantSay>I&rsquo;ll read the existing component first, then split it.</AssistantSay>
      </Line>
      <Line p={p('term')} at={0.68}>
        <ToolCall name="Read" args="src/onboarding/Stepper.tsx" />
        <ToolResult>Read 142 lines</ToolResult>
      </Line>
      <Line p={p('plan')} at={0.12}>
        <ToolCall name="Write" args="plan.md" />
        <ToolResult>
          <span className="text-[#3fb950]">+24</span>
          <span className="ml-2 text-white/55">lines (new)</span>
        </ToolResult>
        <Continuation>stepper shell, per-account progress, retire WelcomeIntro</Continuation>
      </Line>
      <Line p={p('preview')} at={0.25}>
        <ToolCall name="Edit" args="src/onboarding/Stepper.tsx" />
        <ToolResult>
          <span className="text-[#3fb950]">+92</span>
          <span className="mx-1 text-white/30">/</span>
          <span className="text-[#f85149]">−14</span>
          <span className="ml-2 text-white/55">lines</span>
        </ToolResult>
      </Line>
      <Line p={p('status')} at={0.2}>
        <ToolCall name="Bash" args="npm test -- onboarding" />
        <ToolResult>
          <span className="text-[#3fb950]">PASS</span>
          <span className="ml-2 text-white/65">14 tests</span>
          <span className="ml-2 text-white/35">in 2.1s</span>
        </ToolResult>
      </Line>
      <Line p={p('status')} at={0.55}>
        <ToolCall name="Edit" args="src/onboarding/WelcomeIntro.tsx" />
        <ToolResult dim>retiring the old screen&hellip;</ToolResult>
      </Line>
    </ClaudeShell>
  );
}

function Workbench() {
  const keys = BEATS.map((b) => b.key);
  const { setRow, progress } = useScrubRows(keys);
  const p = (k: string) => progress[k] ?? 0;

  const planV = clamp01((p('plan') - 0.45) / 0.22) * (1 - clamp01((p('preview') - 0.35) / 0.22));
  const st = clamp01((p('status') - 0.45) / 0.25);
  const frontDev = p('preview') > 0.5 && p('status') < 0.5;
  const testDone = st > 0.3;

  const base = getPanelFixtures('pty-101-dev');
  const claudeFixtures: PanelFixtures = {
    plan: p('plan') > 0.2 ? base.plan : undefined,
    diff: p('preview') > 0.35 ? base.diff : undefined,
  };
  const claudeOpenPanel: PanelKind | null = planV > 0.5 ? 'plan' : null;

  const order = frontDev ? ['dev', 'claude', 'test', 'shell'] : ['claude', 'test', 'shell', 'dev'];
  const pos = (id: string) => order.indexOf(id);

  return (
    <div className="bl-split">
      <div className="bl-steps">
        {BEATS.map((b) => (
          <div key={b.key} ref={setRow(b.key)} className="bl-step">
            <h3>{b.title}</h3>
            <p>{b.body}</p>
          </div>
        ))}
      </div>
      <div className="bl-rail" style={{ width: 780 }}>
        <div className="plan-desk" style={{ backgroundImage: DESK_INDIGO, padding: 28, paddingTop: 104 }}>
          <div className="relative" style={{ height: 480 }}>
            {/* Stable DOM order; stacking comes from isActive/backDepth so the
                depth transitions animate instead of remounting. */}
            <TerminalCardView isActive={pos('claude') === 0} backDepth={pos('claude')}>
              <TerminalHeaderView
                summaryType="thinking"
                isActive={pos('claude') === 0}
                isBackCard={pos('claude') !== 0}
                stackPosition={pos('claude') || undefined}
                nameContent={
                  <TerminalHeaderName
                    label={pos('claude') === 0 ? 'claude' : 'Rework onboarding flow'}
                    lastOscTitle="Editing onboarding stepper..."
                  />
                }
                branchContent={pos('claude') === 0 ? <BranchLabel branch="rework-onboarding" /> : undefined}
                actions={
                  pos('claude') === 0 && (claudeFixtures.plan || claudeFixtures.diff) ? (
                    <ActiveActions fixtures={claudeFixtures} openPanel={claudeOpenPanel} onToggle={() => {}} />
                  ) : undefined
                }
              />
              {pos('claude') === 0 && (
                <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
                  <WorkbenchSession p={p} />
                  {planV > 0.02 && base.plan && (
                    <div className="absolute inset-0" style={{ opacity: planV, pointerEvents: 'none' }}>
                      <MockPlanPanel fixture={base.plan} onClose={() => {}} />
                    </div>
                  )}
                </div>
              )}
            </TerminalCardView>
            <TerminalCardView isActive={pos('dev') === 0} backDepth={pos('dev')}>
              <TerminalHeaderView
                summaryType="ready"
                isActive={pos('dev') === 0}
                isBackCard={pos('dev') !== 0}
                stackPosition={pos('dev') || undefined}
                nameContent={
                  <TerminalHeaderName
                    label={pos('dev') === 0 ? 'dev' : 'Rework onboarding flow'}
                    lastOscTitle="live dev server"
                  />
                }
                branchContent={pos('dev') === 0 ? <BranchLabel branch="rework-onboarding" /> : undefined}
                actions={
                  pos('dev') === 0 ? <ActiveActions fixtures={base} openPanel="preview" onToggle={() => {}} /> : undefined
                }
              />
              {pos('dev') === 0 && (
                <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
                  <DevServerBody />
                  {base.preview && (
                    <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                      <MockPreviewPanel fixture={base.preview} onClose={() => {}} />
                    </div>
                  )}
                </div>
              )}
            </TerminalCardView>
            <TerminalCardView backDepth={pos('test')}>
              <TerminalHeaderView
                summaryType={testDone ? 'ready' : 'thinking'}
                isBackCard
                stackPosition={pos('test')}
                nameContent={
                  <TerminalHeaderName
                    label="Polish invitation email"
                    lastOscTitle={testDone ? 'done · 14 passed' : 'Tightening brand tokens...'}
                  />
                }
              />
            </TerminalCardView>
            <TerminalCardView backDepth={pos('shell')}>
              <TerminalHeaderView
                summaryType="thinking"
                sandboxed
                isBackCard
                stackPosition={pos('shell')}
                nameContent={
                  <TerminalHeaderName label="Audit accessibility on settings dialog" lastOscTitle="running axe (lima)" />
                }
              />
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
        </div>
      </div>
    </div>
  );
}

/* ─── The strip ───────────────────────────────────────────────────── */

const HOOKS = [
  { label: 'Start', description: 'To Do → In Progress', command: 'claude "$OUIJIT_TASK_DESCRIPTION"' },
  { label: 'Continue', description: 'Reopening a running task', command: 'claude --continue' },
  { label: 'Run', description: 'The Run button', command: 'npm run dev' },
  { label: 'Review', description: 'In Progress → In Review', command: 'gh pr create --fill' },
  { label: 'Done', description: 'In Review → Done', command: 'git push origin HEAD' },
];

function StripPanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="glass-bevel rounded-[12px] border border-bezel-panel overflow-hidden"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      {children}
    </div>
  );
}

function Strip() {
  return (
    <div className="bl-strip">
      <div className="bl-strip-cell">
        <h4>Contain untrusted code</h4>
        <p>Run any terminal in a Lima VM or under nono. The ringed dot marks it.</p>
        <StripPanel>
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
            <StatusDot summaryType="thinking" sandboxed />
            <span className="font-mono text-xs font-medium text-ink/85 whitespace-nowrap">claude · lima</span>
            <span className="font-mono text-xs text-ink/45 truncate">— npm install…</span>
          </div>
          <div className="px-3 pt-2 pb-1 text-[11px] text-text-tertiary">Open in</div>
          <div className="pb-1 text-[13px]">
            <div className="px-3 py-1.5 text-text-secondary">Terminal</div>
            <div className="px-3 py-1.5 bg-accent text-accent-ink flex items-center justify-between">
              <span>Lima VM sandbox</span>
              <Icon name="check" className="w-3.5 h-3.5" />
            </div>
            <div className="px-3 py-1.5 text-text-secondary">nono sandbox</div>
          </div>
        </StripPanel>
      </div>
      <div className="bl-strip-cell">
        <h4>Hooks on every move</h4>
        <p>Your commands run as tasks change status.</p>
        <StripPanel>
          <div className="divide-y divide-white/[0.06]">
            {HOOKS.map((h) => (
              <HookRowView key={h.label} label={h.label} description={h.description} command={h.command} actionLabel=" " />
            ))}
          </div>
        </StripPanel>
      </div>
      <div className="bl-strip-cell">
        <h4>Agents drive the board</h4>
        <p>The session-aware CLI works from inside every terminal.</p>
        <StripPanel>
          <div className="px-3 py-2.5 font-mono text-[11px] leading-[1.8]">
            <div className="text-white/80">
              <span className="text-white/40">$</span> ouijit task create "Audit useTransition usages"
            </div>
            <div className="text-white/50">
              Created task <span className="text-white/75">#144</span>
            </div>
            <div className="text-white/80 mt-1">
              <span className="text-white/40">$</span> ouijit task set-status 142 in_review
            </div>
            <div className="text-white/50">
              #142 <span className="text-white/65">in_progress → in_review</span>
            </div>
          </div>
        </StripPanel>
      </div>
    </div>
  );
}

/* ─── The section ─────────────────────────────────────────────────── */

export function BuildSectionCandidate() {
  return (
    <div>
      <h2 className="plan-v-headline">Build in parallel</h2>
      <p className="bl-standfirst">Every task gets its own worktree, terminal, and agent. You keep the overview.</p>
      <Workbench />
      <Strip />
    </div>
  );
}
