import { useEffect, useRef, useState } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { ClaudeShell, ClaudeUser, AssistantSay, ToolCall, ToolResult, Continuation } from './stackParts';
import { DeskWash } from './DeskWash';

/**
 * Build section lab, round 10 — the app's own terminal stack, one card to five,
 * on an iris desk. No new visual language: the chrome, the depth ramp, and the
 * peek above each back card are the ones the product already draws.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const GREEN = 'text-[#3fb950]';
const RED = 'text-[#f85149]';

function Lines({ added, removed, note }: { added: number; removed?: number; note?: string }) {
  return (
    <ToolResult>
      <span className={GREEN}>+{added}</span>
      {removed != null && (
        <>
          <span className="mx-1 text-white/30">/</span>
          <span className={RED}>−{removed}</span>
        </>
      )}
      <span className="ml-2 text-white/55">{note ?? 'lines'}</span>
    </ToolResult>
  );
}

const SESSIONS = [
  {
    task: 'T-101',
    label: 'Rework onboarding flow',
    branch: 'rework-onboarding',
    osc: 'Editing onboarding stepper…',
    state: 'thinking',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>Split onboarding into a three-step stepper with saved progress.</ClaudeUser>
        <AssistantSay>I&rsquo;ll read the existing component first, then split it.</AssistantSay>
        <ToolCall name="Read" args="src/onboarding/Stepper.tsx" />
        <ToolResult>Read 142 lines</ToolResult>
        <ToolCall name="Edit" args="src/onboarding/Stepper.tsx" />
        <Lines added={92} removed={14} />
        <Continuation>persists progress, adds a back affordance, retires WelcomeIntro</Continuation>
        <ToolCall name="Write" args="src/onboarding/useOnboardingProgress.ts" />
        <Lines added={38} note="lines (new)" />
      </ClaudeShell>
    ),
  },
  {
    task: 'T-102',
    label: 'Wire payment retries',
    branch: 'billing-retries',
    osc: 'Reading dunningQueue.ts…',
    state: 'thinking',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>Retry failed charges through the dunning queue instead of failing the invoice.</ClaudeUser>
        <AssistantSay>Reading the router to see where a charge currently gives up.</AssistantSay>
        <ToolCall name="Read" args="src/billing/webhookRouter.ts" />
        <ToolResult>Read 612 lines</ToolResult>
        <ToolCall name="Edit" args="src/billing/dunningQueue.ts" />
        <Lines added={18} removed={4} />
        <Continuation>backs off 1h, 6h, 24h before marking the invoice past due</Continuation>
      </ClaudeShell>
    ),
  },
  {
    task: 'T-103',
    label: 'Polish invitation email',
    branch: 'polish-invitation-email',
    osc: 'done · 14 passed',
    state: 'ready',
    body: (
      <ClaudeShell>
        <ClaudeUser>Match the invitation email to the new brand tokens.</ClaudeUser>
        <ToolCall name="Write" args="app/mailers/templates/invitation.tsx" />
        <Lines added={34} removed={2} />
        <ToolCall name="Bash" args="npm run build:mail" />
        <ToolResult>
          <span className={GREEN}>ok</span>
          <span className="ml-2 text-white/35">in 3.4s</span>
        </ToolResult>
        <AssistantSay>Done — the header and CTA now read from the shared tokens.</AssistantSay>
      </ClaudeShell>
    ),
  },
  {
    task: 'T-104',
    label: 'Speed up search index',
    branch: 'speed-search-index',
    osc: 'Running npm test…',
    state: 'thinking',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>The index build takes four minutes on a cold cache. Find out why.</ClaudeUser>
        <AssistantSay>The tokenizer re-reads every document per field. Batching it first.</AssistantSay>
        <ToolCall name="Edit" args="src/search/tokenizer.ts" />
        <Lines added={40} removed={12} />
        <ToolCall name="Bash" args="npm run bench:index" />
        <ToolResult>
          <span className={GREEN}>2.1× faster</span>
          <span className="ml-2 text-white/35">114s → 54s</span>
        </ToolResult>
      </ClaudeShell>
    ),
  },
  {
    task: 'T-105',
    label: 'Add CSV export',
    branch: 'invoices-csv-export',
    osc: 'Writing toCsv.ts…',
    state: 'thinking',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>Add a CSV export to the invoices table, respecting the current filters.</ClaudeUser>
        <AssistantSay>I&rsquo;ll put the serialiser beside the table so the columns stay in one place.</AssistantSay>
        <ToolCall name="Write" args="src/invoices/toCsv.ts" />
        <Lines added={64} note="lines (new)" />
        <ToolCall name="Edit" args="src/invoices/InvoicesTable.tsx" />
        <Lines added={47} removed={6} />
      </ClaudeShell>
    ),
  },
];

const N = SESSIONS.length;

/** The stack's own geometry: what a back card peeks above the one in front,
 *  and how much it narrows. The app caps its depth ramp at four cards, so a
 *  deeper stack supplies its own rather than repeating the fourth. */
const PEEK = 24;
/** Clearance above the deepest card. A shade over the desk's 36px padding,
 *  since the back cards narrow and read lighter than the front one. */
const TOP_PAD = 44;
const NARROW = 0.014;

/** What one arrival costs in scroll. The run is a viewport for the sticky
 *  hold, that per card, and a tail so the finished stack sits for a moment. */
const PER_CARD_VH = 26;
const TAIL_VH = 24;
const RUN_VH = 100 + (N - 1) * PER_CARD_VH + TAIL_VH;
/** The share of the scrub the arrivals take, leaving the tail to hold. */
const GROW_SPAN = ((N - 1) * PER_CARD_VH) / (RUN_VH - 100);

function useStageScrub() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState(0);
  const last = useRef(-1);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const next = span > 0 ? clamp01(-rect.top / span) : 0;
      const rounded = Math.round(next * 1000);
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

  return { wrapRef, t };
}

function useStaticMode() {
  const [staticMode, setStaticMode] = useState(false);
  useEffect(() => {
    const queries = [window.matchMedia('(max-width: 860px)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
    const update = () => setStaticMode(queries.some((q) => q.matches));
    update();
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return staticMode;
}

/* ─── The stage ───────────────────────────────────────────────────── */

export function VariantStack() {
  const { wrapRef, t } = useStageScrub();
  const staticMode = useStaticMode();
  const grown = staticMode ? N : 1 + clamp01(t / GROW_SPAN) * (N - 1);
  /*
   * TerminalCardStack: a new session is appended and becomes active, every
   * other card's backDepth goes up by one, and the container's top drops a
   * peek — all of it over the same 0.2s. Here the scroll is that clock, so
   * `f` is how far through the current arrival we are.
   */
  const frontIndex = staticMode ? N - 1 : Math.min(N - 1, Math.ceil(grown) - 1);
  const f = staticMode ? 1 : clamp01(grown - frontIndex);
  const backCards = frontIndex - 1 + f;

  return (
    <div ref={wrapRef} style={{ height: staticMode ? 'auto' : `${RUN_VH}vh` }}>
      <div className="stk-sticky">
        <div className="plan-desk desk-wash desk-wash--iris stk-desk">
          <DeskWash />
          {/* The well starts one peek lower per back card and the cards fill
              what is left, so the front card gives up height as the stack
              deepens — the same trade the app's stack container makes. */}
          <div className="stk-well" style={{ top: TOP_PAD + Math.max(0, backCards) * PEEK }}>
            {SESSIONS.map((session, i) => {
              if (i > frontIndex) return null;
              const front = i === frontIndex;
              // The app sorts back cards by distance descending before
              // numbering them, so ⌘1 is the deepest card, not the nearest.
              const rank = i + 1;
              const depth = front ? 0 : frontIndex - 1 - i + f;
              return (
                <div
                  key={session.task}
                  className="stk-card"
                  style={{
                    // Depth, not rank — DEPTH_STYLES runs 9 down to 6 behind
                    // the active card's 10, and ⌘1 is the deepest of them.
                    zIndex: front ? 10 : 10 - Math.max(1, Math.ceil(depth)),
                    opacity: 1,
                    transform: `translateY(${-depth * PEEK}px) scaleX(${1 - depth * NARROW})`,
                  }}
                >
                  <TerminalCardView isActive={front}>
                    <TerminalHeaderView
                      summaryType={session.state}
                      isActive={front}
                      isBackCard={!front}
                      stackPosition={front ? undefined : rank}
                      nameContent={
                        <TerminalHeaderName
                          label={front ? 'claude' : session.label}
                          lastOscTitle={session.osc}
                        />
                      }
                      branchContent={
                        front ? (
                          <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink/45">
                            <Icon name="git-branch" className="w-3 h-3" />
                            {session.branch}
                          </span>
                        ) : undefined
                      }
                    />
                    {front && session.body}
                  </TerminalCardView>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
