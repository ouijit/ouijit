import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
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
 * Build section lab, round 3 — the Workbench developed: one sticky terminal
 * stack whose scroll beats walk the real surfaces. Three candidates differ in
 * how much of the pillar the stack itself carries.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const DESK_HUES = {
  indigo:
    'radial-gradient(120% 140% at 15% 0%, rgba(99, 102, 241, 0.32), transparent 60%), radial-gradient(130% 130% at 100% 100%, rgba(56, 189, 248, 0.14), transparent 55%), linear-gradient(180deg, #191a2e, #121218)',
  graphite: 'radial-gradient(120% 140% at 50% 0%, rgba(255, 255, 255, 0.05), transparent 60%), linear-gradient(180deg, #1c1d23, #131318)',
} as const;

/** Per-beat glows stacked onto a graphite desk as the story advances. */
const CHARGE_LAYERS: Record<string, string> = {
  plan: 'radial-gradient(120% 140% at 15% 0%, rgba(99, 102, 241, 0.30), transparent 60%)',
  preview:
    'radial-gradient(120% 140% at 85% 10%, rgba(45, 212, 191, 0.22), transparent 60%)',
  status:
    'radial-gradient(120% 130% at 50% 100%, rgba(233, 103, 159, 0.20), transparent 60%)',
};

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

/* ─── The workbench core ──────────────────────────────────────────── */

type BeatKey = 'term' | 'plan' | 'preview' | 'cli' | 'status';

interface Beat {
  key: BeatKey;
  title: string;
  body: string;
}

/** The active claude session, growing with the beats: the start hook opens
 * it, plan.md gets written as the plan beat arrives, and (when the variant
 * includes a cli beat) the agent finishes by moving its own task. */
function WorkbenchSession({
  pTerm,
  pPlan,
  cliP,
  done,
}: {
  pTerm: number;
  pPlan: number;
  /** -1 when the variant has no cli beat: the mid-session lines show statically. */
  cliP: number;
  done: boolean;
}) {
  const hasCli = cliP >= 0;
  return (
    <ClaudeShell busy={!done}>
      <Line p={pTerm} at={0.25}>
        <div className="text-white/45">
          <span className="text-white/30">$</span> claude "$OUIJIT_TASK_DESCRIPTION"
        </div>
      </Line>
      <Line p={pTerm} at={0.4}>
        <ClaudeUser>Split onboarding into a three-step stepper with saved progress.</ClaudeUser>
      </Line>
      <Line p={pTerm} at={0.55}>
        <AssistantSay>I&rsquo;ll read the existing component first, then split it.</AssistantSay>
      </Line>
      <Line p={pTerm} at={0.68}>
        <ToolCall name="Read" args="src/onboarding/Stepper.tsx" />
        <ToolResult>Read 142 lines</ToolResult>
      </Line>
      <Line p={pPlan} at={0.12}>
        <ToolCall name="Write" args="plan.md" />
        <ToolResult>
          <span className="text-[#3fb950]">+24</span>
          <span className="ml-2 text-white/55">lines (new)</span>
        </ToolResult>
        <Continuation>stepper shell, per-account progress, retire WelcomeIntro</Continuation>
      </Line>
      <Line p={hasCli ? cliP : 1} at={hasCli ? 0.25 : 0}>
        <ToolCall name="Edit" args="src/onboarding/Stepper.tsx" />
        <ToolResult>
          <span className="text-[#3fb950]">+92</span>
          <span className="mx-1 text-white/30">/</span>
          <span className="text-[#f85149]">−14</span>
          <span className="ml-2 text-white/55">lines</span>
        </ToolResult>
      </Line>
      <Line p={hasCli ? cliP : 1} at={hasCli ? 0.42 : 0}>
        <ToolCall name="Bash" args="npm test -- onboarding" />
        <ToolResult>
          <span className="text-[#3fb950]">PASS</span>
          <span className="ml-2 text-white/65">14 tests</span>
          <span className="ml-2 text-white/35">in 2.1s</span>
        </ToolResult>
      </Line>
      {hasCli && (
        <>
          <Line p={cliP} at={0.58}>
            <ToolCall name="Bash" args="ouijit task set-status 101 in_review" />
          </Line>
          <Line p={cliP} at={0.7}>
            <ToolResult>
              #101 <span className="text-white/65">in_progress → in_review</span>
            </ToolResult>
          </Line>
          {done && (
            <AssistantSay>
              <span>Ready for review.</span>
              <span className="ml-1 text-white/55">Saved progress in, WelcomeIntro retired.</span>
            </AssistantSay>
          )}
        </>
      )}
    </ClaudeShell>
  );
}

function WorkbenchCore({
  beats,
  promote = false,
  charge = false,
}: {
  beats: Beat[];
  /** The preview beat brings the dev-server terminal to the front of the
   * stack (the preview panel lives on that terminal), instead of opening
   * the preview over the claude session. */
  promote?: boolean;
  charge?: boolean;
}) {
  const keys = beats.map((b) => b.key);
  const { setRow, progress } = useScrubRows(keys);
  const p = (k: BeatKey) => progress[k] ?? 0;

  const hasCli = keys.includes('cli');
  const afterPreview: BeatKey = hasCli ? 'cli' : 'status';
  const planV = clamp01((p('plan') - 0.45) / 0.22) * (1 - clamp01((p('preview') - 0.35) / 0.22));
  const previewV = clamp01((p('preview') - 0.45) / 0.22) * (1 - clamp01((p(afterPreview) - 0.35) / 0.22));
  const st = clamp01((p('status') - 0.45) / 0.25);
  // Without a cli beat nothing in the story moves the claude task, so the
  // finale belongs to the back card alone and claude keeps working.
  const done = hasCli && st > 0.55;
  const frontDev = promote && p('preview') > 0.5 && p(afterPreview) < 0.5;

  const base = getPanelFixtures('pty-101-dev');
  const claudeFixtures: PanelFixtures = {
    plan: p('plan') > 0.2 ? base.plan : undefined,
    diff: (hasCli ? p('cli') > 0.35 : p('plan') > 0.2) ? base.diff : undefined,
    preview: promote ? undefined : base.preview,
  };
  const claudeOpenPanel: PanelKind | null = !promote && previewV > 0.5 ? 'preview' : planV > 0.5 ? 'plan' : null;

  const order = frontDev ? ['dev', 'claude', 'test', 'shell'] : ['claude', 'test', 'shell', 'dev'];
  const pos = (id: string) => order.indexOf(id);

  const notifBody = hasCli
    ? 'Rework onboarding flow — ready for review'
    : 'Polish invitation email — done · 14 passed';
  const testDone = !hasCli && st > 0.3;

  return (
    <div className="bl-split">
      <div className="bl-steps">
        {beats.map((b) => (
          <div key={b.key} ref={setRow(b.key)} className="bl-step">
            <h3>{b.title}</h3>
            <p>{b.body}</p>
          </div>
        ))}
      </div>
      <div className="bl-rail" style={{ width: 780 }}>
        <div
          className="plan-desk"
          style={{ backgroundImage: charge ? DESK_HUES.graphite : DESK_HUES.indigo, padding: 28, paddingTop: 104 }}
        >
          {charge &&
            (['plan', 'preview', 'status'] as const).map((k) => (
              <div
                key={k}
                className="absolute inset-0 pointer-events-none"
                style={{
                  borderRadius: 'inherit',
                  backgroundImage: CHARGE_LAYERS[k],
                  opacity: p(k) > 0.5 ? 1 : 0,
                  transition: 'opacity 700ms ease',
                }}
              />
            ))}
          <div className="relative" style={{ height: 480 }}>
            {/* Stable DOM order; stacking comes from isActive/backDepth so the
                depth transitions animate instead of remounting. */}
            <TerminalCardView isActive={pos('claude') === 0} backDepth={pos('claude')}>
              <TerminalHeaderView
                summaryType={done ? 'ready' : 'thinking'}
                isActive={pos('claude') === 0}
                isBackCard={pos('claude') !== 0}
                stackPosition={pos('claude') || undefined}
                nameContent={
                  <TerminalHeaderName
                    label={pos('claude') === 0 ? 'claude' : 'Rework onboarding flow'}
                    lastOscTitle={done ? 'ready for review' : 'Editing onboarding stepper...'}
                  />
                }
                branchContent={pos('claude') === 0 ? <BranchLabel branch="rework-onboarding" /> : undefined}
                actions={
                  pos('claude') === 0 ? (
                    <ActiveActions fixtures={claudeFixtures} openPanel={claudeOpenPanel} onToggle={() => {}} />
                  ) : undefined
                }
              />
              {pos('claude') === 0 && (
                <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
                  <WorkbenchSession pTerm={p('term')} pPlan={p('plan')} cliP={hasCli ? p('cli') : -1} done={done} />
                  {planV > 0.02 && base.plan && (
                    <div className="absolute inset-0" style={{ opacity: planV, pointerEvents: 'none' }}>
                      <MockPlanPanel fixture={base.plan} onClose={() => {}} />
                    </div>
                  )}
                  {!promote && previewV > 0.02 && base.preview && (
                    <div className="absolute inset-0" style={{ opacity: previewV, pointerEvents: 'none' }}>
                      <MockPreviewPanel fixture={base.preview} onClose={() => {}} />
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
                  pos('dev') === 0 ? (
                    <ActiveActions fixtures={base} openPanel="preview" onToggle={() => {}} />
                  ) : undefined
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
                  <TerminalHeaderName
                    label="Audit accessibility on settings dialog"
                    lastOscTitle="running axe (lima)"
                  />
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
            <MacNotification body={notifBody} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ 3a · Deep workbench — the whole pillar on one stack ═══ */

const DEEP_BEATS: Beat[] = [
  {
    key: 'term',
    title: 'Born in a worktree',
    body: 'The start hook launches your agent on the task’s own branch, prompt in hand.',
  },
  {
    key: 'plan',
    title: 'The plan rides along',
    body: 'plan.md opens as a panel on the terminal. The agent keeps it current while it works.',
  },
  {
    key: 'preview',
    title: 'See it running',
    body: 'The dev server terminal is one ⌘-tap behind, preview panel already pointed at it.',
  },
  {
    key: 'cli',
    title: 'Agents drive the board',
    body: 'The CLI is session-aware — when tests pass, the agent moves its own task to In Review.',
  },
  {
    key: 'status',
    title: 'Look away freely',
    body: 'Statuses track every terminal, and a notification lands the moment one finishes.',
  },
];

export function VariantDeep() {
  return <WorkbenchCore beats={DEEP_BEATS} promote />;
}

/* ═══ 3b · Workbench + strip — tight stack, the rest rides below ═══ */

const TIGHT_BEATS: Beat[] = [
  {
    key: 'term',
    title: 'A terminal per task',
    body: 'Every task runs in its own worktree; the start hook launches the agent with the task’s prompt.',
  },
  DEEP_BEATS[1],
  {
    key: 'preview',
    title: 'See it running',
    body: 'Point a preview panel at the dev server without leaving the task.',
  },
  DEEP_BEATS[4],
];

const HOOKS = [
  { label: 'Start', description: 'To Do → In Progress', command: 'claude "$OUIJIT_TASK_DESCRIPTION"' },
  { label: 'Run', description: 'The Run button', command: 'npm run dev' },
  { label: 'Review', description: 'In Progress → In Review', command: 'gh pr create --fill' },
];

export function VariantStrip() {
  return (
    <div>
      <WorkbenchCore beats={TIGHT_BEATS} />
      <div className="bl-strip">
        <div className="bl-strip-cell">
          <h4>Contain untrusted code</h4>
          <p>A Lima VM mounting only the task&rsquo;s files, or nono in place.</p>
          <div className="rounded-[12px] border border-bezel-panel overflow-hidden text-[13px]" style={{ background: 'var(--color-terminal-bg)' }}>
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
        <div className="bl-strip-cell">
          <h4>Hooks on every move</h4>
          <p>Your commands run as tasks change status.</p>
          <div className="rounded-[12px] border border-bezel-panel overflow-hidden" style={{ background: 'var(--color-terminal-bg)' }}>
            <div className="divide-y divide-white/[0.06]">
              {HOOKS.map((h) => (
                <HookRowView key={h.label} label={h.label} description={h.description} command={h.command} actionLabel=" " />
              ))}
            </div>
          </div>
        </div>
        <div className="bl-strip-cell">
          <h4>Agents drive the board</h4>
          <p>The CLI is session-aware in every terminal.</p>
          <div className="rounded-[12px] border border-bezel-panel px-3 py-2.5 font-mono text-[11px] leading-[1.8]" style={{ background: 'var(--color-terminal-bg)' }}>
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
        </div>
      </div>
    </div>
  );
}

/* ═══ 3c · Charged workbench — the desk gains a hue per beat ═══ */

export function VariantCharged() {
  return <WorkbenchCore beats={TIGHT_BEATS} charge />;
}
