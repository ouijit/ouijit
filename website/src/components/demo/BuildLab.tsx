import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { HookRowView } from '../../ouijit-ui/components/scripts/HookRowView';
import { MockPlanPanel, MockPreviewPanel, MockDiffPanel, getPanelFixtures, type PanelFixtures } from './MockPanels';
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
  TestBody,
  type PanelKind,
} from './stackParts';

/**
 * Build section lab, round 5 — same workbench, different stagings. The Plan
 * section owns the side-copy + sticky-desk silhouette, so these variants try
 * shapes it doesn't use.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const DESK_INDIGO =
  'radial-gradient(120% 140% at 15% 0%, rgba(99, 102, 241, 0.32), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(56, 189, 248, 0.14), transparent 55%), linear-gradient(180deg, #191a2e, #121218)';

/* ─── Scrub sources ───────────────────────────────────────────────── */

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

/** One tall wrapper drives all beats: t is the wrapper's scroll fraction and
 * each beat ramps inside its own staggered window, with plateaus between. */
function useTheaterScrub(keys: readonly string[]) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState(0);
  const last = useRef(-1);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const next = clamp01(-rect.top / (rect.height - vh));
      const rounded = Math.round(next * 800);
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

  const step = 0.78 / (keys.length - 1);
  const p = (k: string) => {
    const i = keys.indexOf(k);
    if (i < 0) return 0;
    return clamp01((t - i * step) / (step * 0.64));
  };
  return { wrapRef, p };
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

/** The onboarding preview in dark mode — the shared white fixture glares
 * against the marketing page, so the promoted preview shows this instead. */
function DarkOnboardingPage() {
  return (
    <div className="w-full h-full flex flex-col bg-[#0f0f11] text-white/90 font-sans overflow-hidden">
      <div className="px-6 py-3 border-b border-white/[0.08] flex items-center gap-3">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-accent to-[#9af0c0]" />
        <span className="text-[12px] font-medium">Constellation</span>
        <div className="ml-auto text-[11px] text-white/40">Step 2 of 3</div>
      </div>
      <div className="flex-1 flex flex-col items-center px-8 pt-6 pb-3 overflow-hidden min-h-0">
        <div className="text-[15px] font-semibold mb-1">Pick a workspace name</div>
        <div className="text-[11px] text-white/45 mb-4">You can change this later in settings.</div>
        <div className="w-full max-w-[320px] flex flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Workspace name</div>
            <div className="px-2.5 py-1.5 rounded border border-accent/60 bg-white/[0.05] text-[12px] ring-[3px] ring-accent/15">
              Northwind
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Subdomain</div>
            <div className="flex items-center px-2.5 py-1.5 rounded border border-white/15 bg-white/[0.04] text-[12px] gap-1">
              <span className="text-white/85">northwind</span>
              <span className="text-white/35">.constellation.app</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <button className="px-3 py-1.5 rounded text-[11px] text-white/60 bg-transparent border border-white/15">
              Back
            </button>
            <button className="px-3 py-1.5 rounded text-[11px] text-accent-ink bg-accent border-none">Continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── The workbench stack ─────────────────────────────────────────── */

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
    key: 'diff',
    title: 'Watch the diff grow',
    body: 'Every change on the task’s branch, one tab over — hunk by hunk, as it happens.',
  },
  {
    key: 'status',
    title: 'Look away freely',
    body: 'Statuses track every terminal, and a notification lands the moment one finishes.',
  },
] as const;

const BEAT_KEYS = BEATS.map((b) => b.key);

/** The active claude session, growing across all four beats. */
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
      <Line p={p('diff')} at={0.3}>
        <ToolCall name="Bash" args="npm test -- onboarding" />
        <ToolResult>
          <span className="text-[#3fb950]">PASS</span>
          <span className="ml-2 text-white/65">14 tests</span>
          <span className="ml-2 text-white/35">in 2.1s</span>
        </ToolResult>
      </Line>
    </ClaudeShell>
  );
}

/** The stack and its notification, independent of any desk or layout. The
 * host provides ~92px of headroom above for the back-card peeks and the
 * notification.
 *
 * Nothing transitions inside a terminal: each beat is a different terminal
 * promoted to the front, already showing its panel — the plan beat brings
 * up the invitation task's terminal with its plan open, the preview beat
 * the dev terminal, and the finale returns to claude with more output. */
function WorkbenchStack({ p }: { p: (k: string) => number }) {
  const st = clamp01((p('status') - 0.45) / 0.25);
  const testDone = st > 0.3;

  const onboarding = getPanelFixtures('pty-101-dev');
  const invitation = getPanelFixtures('pty-103-test');
  const claudeFixtures: PanelFixtures = {
    plan: p('plan') > 0.12 ? onboarding.plan : undefined,
    diff: p('preview') > 0.35 ? onboarding.diff : undefined,
  };

  const diffOpen = p('diff') > 0.5;
  const front = diffOpen ? 'claude' : p('preview') > 0.5 ? 'dev' : p('plan') > 0.5 ? 'test' : 'claude';
  const order = [front, ...['claude', 'test', 'dev', 'audit'].filter((id) => id !== front)];
  const pos = (id: string) => order.indexOf(id);

  return (
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
              <ActiveActions fixtures={claudeFixtures} openPanel={diffOpen ? 'diff' : null} onToggle={() => {}} />
            ) : undefined
          }
        />
        {pos('claude') === 0 && (
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <WorkbenchSession p={p} />
            </div>
            {/* Opened while the card was backgrounded — it returns to the
                front already split, so nothing transitions in view. */}
            {diffOpen && onboarding.diff && (
              <>
                <div className="pane-seam relative w-px shrink-0" />
                <div className="relative shrink-0" style={{ width: '50%' }}>
                  <MockDiffPanel fixture={onboarding.diff} compact onClose={() => {}} />
                </div>
              </>
            )}
          </div>
        )}
      </TerminalCardView>
      <TerminalCardView isActive={pos('test') === 0} backDepth={pos('test')}>
        <TerminalHeaderView
          summaryType={testDone ? 'ready' : 'thinking'}
          isActive={pos('test') === 0}
          isBackCard={pos('test') !== 0}
          stackPosition={pos('test') || undefined}
          nameContent={
            <TerminalHeaderName
              label={pos('test') === 0 ? 'claude' : 'Polish invitation email'}
              lastOscTitle={testDone ? 'done · 14 passed' : 'Tightening brand tokens...'}
            />
          }
          branchContent={pos('test') === 0 ? <BranchLabel branch="polish-invitation-email" /> : undefined}
          actions={
            pos('test') === 0 ? (
              <ActiveActions fixtures={invitation} openPanel="plan" onToggle={() => {}} />
            ) : undefined
          }
        />
        {pos('test') === 0 && (
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <TestBody />
            </div>
            <div className="pane-seam relative w-px shrink-0" />
            <div className="relative shrink-0" style={{ width: '50%' }}>
              {invitation.plan && <MockPlanPanel fixture={invitation.plan} onClose={() => {}} />}
            </div>
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
            <TerminalHeaderName label={pos('dev') === 0 ? 'dev' : 'Rework onboarding flow'} lastOscTitle="live dev server" />
          }
          branchContent={pos('dev') === 0 ? <BranchLabel branch="rework-onboarding" /> : undefined}
          actions={
            pos('dev') === 0 ? <ActiveActions fixtures={onboarding} openPanel="preview" onToggle={() => {}} /> : undefined
          }
        />
        {pos('dev') === 0 && (
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <DevServerBody />
            </div>
            <div className="pane-seam relative w-px shrink-0" />
            <div className="relative shrink-0" style={{ width: '50%' }}>
              {onboarding.preview && (
                <MockPreviewPanel fixture={{ ...onboarding.preview, page: <DarkOnboardingPage /> }} onClose={() => {}} />
              )}
            </div>
          </div>
        )}
      </TerminalCardView>
      <TerminalCardView backDepth={pos('audit')}>
        <TerminalHeaderView
          summaryType="thinking"
          sandboxed
          isBackCard
          stackPosition={pos('audit')}
          nameContent={
            <TerminalHeaderName label="Audit accessibility on settings dialog" lastOscTitle="running axe (lima)" />
          }
        />
      </TerminalCardView>
      <div
        style={{
          position: 'absolute',
          top: -92,
          right: -14,
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
  );
}

/** Caption visibility: each beat's copy holds until the next beat takes
 * over, with the swap compressed into the first third of each ramp so two
 * captions never linger half-faded on top of each other. */
const capOpacity = (p: (k: string) => number, i: number) => {
  const cur = i === 0 ? 1 : p(BEAT_KEYS[i]);
  const next = i + 1 < BEAT_KEYS.length ? p(BEAT_KEYS[i + 1]) : 0;
  return clamp01(cur / 0.35) * (1 - clamp01(next / 0.35));
};

/* ═══ 5a · Theater — centered stage, one caption at a time below ═══ */

export function VariantTheater() {
  const { wrapRef, p } = useTheaterScrub(BEAT_KEYS);
  return (
    <div ref={wrapRef} style={{ height: '500vh' }}>
      <div className="bl-theater-sticky">
        <div className="plan-desk" style={{ backgroundImage: DESK_INDIGO, padding: 32, paddingTop: 100, width: '100%' }}>
          <WorkbenchStack p={p} />
        </div>
        <div className="bl-theater-captions">
          {BEATS.map((b, i) => (
            <div key={b.key} className="bl-theater-cap" style={{ opacity: capOpacity(p, i) }}>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </div>
          ))}
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

/* ─── The section, as shipped on the c page ───────────────────────── */

export function BuildSection() {
  return (
    <div>
      <h2 className="plan-v-headline">Build in parallel</h2>
      <VariantTheater />
      <Strip />
    </div>
  );
}

/* ═══ 5b · Float — no desk: the stack loose on the page, side copy ═══ */

export function VariantFloat() {
  const { setRow, progress } = useScrubRows(BEAT_KEYS);
  const p = (k: string) => progress[k] ?? 0;
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
      <div className="bl-rail" style={{ width: 780, paddingTop: 96 }}>
        <div className="relative">
          <div className="bl-float-glow" aria-hidden="true" />
          <div className="relative">
            <WorkbenchStack p={p} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Reference — round 4's staging: side copy, desk ═══ */

export function VariantReference() {
  const { setRow, progress } = useScrubRows(BEAT_KEYS);
  const p = (k: string) => progress[k] ?? 0;
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
          <WorkbenchStack p={p} />
        </div>
      </div>
    </div>
  );
}

