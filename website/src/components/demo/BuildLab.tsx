import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
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
import { DeskWash } from './DeskWash';
import { useTheaterLoop, BeatDots } from './theaterLoop';

/**
 * Build section lab, round 5 — same workbench, different stagings. The Plan
 * section owns the side-copy + sticky-desk silhouette, so these variants try
 * shapes it doesn't use.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));


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
    title: 'Start isolated',
    body: 'Each task gets its own git worktree and terminal. The start hook launches your agent with the task’s prompt.',
  },
  {
    key: 'plan',
    title: 'Dock the plan',
    body: 'Any markdown file docks to a terminal as a live panel. For most tasks, that’s the plan.',
  },
  {
    key: 'preview',
    title: 'Preview the app',
    body: 'A preview panel points at any URL. Aim one at the dev server and watch the branch run.',
  },
  {
    key: 'diff',
    title: 'Follow the diff',
    body: 'Every change on the branch appears one tab over, as it happens.',
  },
  {
    key: 'status',
    title: 'Track every session',
    body: 'Statuses show what each terminal is doing, and a notification lands the moment one finishes.',
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
  const st = clamp01((p('status') - 0.06) / 0.3);
  const testDone = st > 0.3;

  const onboarding = getPanelFixtures('pty-101-dev');
  const invitation = getPanelFixtures('pty-103-test');
  const claudeFixtures: PanelFixtures = {
    plan: p('plan') > 0.12 ? onboarding.plan : undefined,
    diff: p('preview') > 0.35 ? onboarding.diff : undefined,
  };

  const diffOpen = p('diff') > 0.08;
  const front = diffOpen ? 'claude' : p('preview') > 0.08 ? 'dev' : p('plan') > 0.08 ? 'test' : 'claude';
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

/* ═══ 5a · Theater — centered stage, the beat captions in a row below ═══ */

export function VariantTheater() {
  const { rootRef, p, progress, active, seek } = useTheaterLoop(BEAT_KEYS);
  
  return (
    <div ref={rootRef} className="bl-theater">
      <div className="plan-desk desk-wash desk-wash--iris" style={{ padding: 32, paddingTop: 100, width: '100%' }}>
        <DeskWash />
        <WorkbenchStack p={p} />
      </div>
      <div className="beat-row">
        {BEATS.map((b, i) => (
          <button type="button" key={b.key} className={i === active ? 'is-active' : undefined} onClick={() => seek(i)}>
            <h3>{b.title}</h3>
            <p>{b.body}</p>
          </button>
        ))}
      </div>
      <BeatDots progress={progress} />
    </div>
  );
}

/* ─── The section, as shipped on the c page ───────────────────────── */

export function BuildSection() {
  return (
    <div>
      <h2 className="plan-v-headline">Build in parallel</h2>
      <VariantTheater />
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
        <div className="plan-desk desk-wash desk-wash--iris" style={{ padding: 28, paddingTop: 104 }}>
          <DeskWash />
          <WorkbenchStack p={p} />
        </div>
      </div>
    </div>
  );
}

