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

  const p = (k: string) => {
    const i = keys.indexOf(k);
    if (i < 0) return 0;
    return clamp01((t - i * 0.22) / 0.14);
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

/** The stack and its notification, independent of any desk or layout. The
 * host provides ~92px of headroom above for the back-card peeks and the
 * notification. */
function WorkbenchStack({ p }: { p: (k: string) => number }) {
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
            <TerminalHeaderName label={pos('dev') === 0 ? 'dev' : 'Rework onboarding flow'} lastOscTitle="live dev server" />
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
                <MockPreviewPanel fixture={{ ...base.preview, page: <DarkOnboardingPage /> }} onClose={() => {}} />
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
    <div ref={wrapRef} style={{ height: '420vh' }}>
      <div className="bl-theater-sticky">
        <div className="plan-desk" style={{ backgroundImage: DESK_INDIGO, padding: 28, paddingTop: 100, width: 900 }}>
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

/* ═══ 5c · Annotated theater — beat copy as callouts on the stage ═══ */

const ANNO_POS: Record<string, { side: 'left' | 'right'; top: number }> = {
  term: { side: 'left', top: 128 },
  plan: { side: 'right', top: 108 },
  preview: { side: 'right', top: 158 },
  status: { side: 'left', top: 34 },
};

export function VariantAnnotated() {
  const { wrapRef, p } = useTheaterScrub(BEAT_KEYS);
  return (
    <div ref={wrapRef} style={{ height: '420vh' }}>
      <div className="bl-theater-sticky">
        <div className="relative">
          <div className="plan-desk" style={{ backgroundImage: DESK_INDIGO, padding: 28, paddingTop: 100, width: 740 }}>
            <WorkbenchStack p={p} />
          </div>
          {BEATS.map((b, i) => {
            const { side, top } = ANNO_POS[b.key];
            const o = capOpacity(p, i);
            return (
              <div
                key={b.key}
                className="bl-anno"
                style={{ top, [side === 'left' ? 'right' : 'left']: '100%', opacity: o, [side === 'left' ? 'marginRight' : 'marginLeft']: 18 } as React.CSSProperties}
              >
                <div className={`bl-anno-line ${side === 'left' ? 'bl-anno-line-r' : 'bl-anno-line-l'}`} aria-hidden="true" />
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
