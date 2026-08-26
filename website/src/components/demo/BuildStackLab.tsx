import { useEffect, useRef, useState } from 'react';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import {
  ClaudeShell,
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  Continuation,
  EditDiff,
  WorkingLine,
} from './stackParts';
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

/** Each session ends mid-action, and its OSC title is that action: the card and
 *  the board row it came from are the same terminal, so they cannot disagree. */
export const SESSIONS = [
  {
    task: 'T-116',
    label: 'Bump deps for security advisory',
    branch: 'bump-deps-advisory',
    osc: 'Running npm audit…',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>Bump the flagged deps and make sure nothing downstream breaks.</ClaudeUser>
        <AssistantSay>Three advisories, all transitive. Taking the minimum bump that clears them.</AssistantSay>
        <ToolCall name="Bash" args="npm audit --json" />
        <ToolResult>3 advisories · 2 high · 1 moderate</ToolResult>
        <Continuation>tar &lt;6.2.1 · ws &lt;8.17.1 · postcss &lt;8.4.31</Continuation>
        <ToolCall name="Bash" args="npm ls tar ws postcss" />
        <ToolResult>all three reached through @vendor/cli@4 · no direct dependents</ToolResult>
        <ToolCall name="Edit" args="package.json" />
        <Lines added={6} removed={6} />
        <EditDiff
          rows={[
            [41, '-', '"tar": "^6.1.11",'],
            [41, '+', '"tar": "^6.2.1",'],
            [52, '-', '"ws": "^8.14.2",'],
            [52, '+', '"ws": "^8.17.1",'],
          ]}
        />
        <ToolCall name="Bash" args="npm install" />
        <ToolResult>4 packages changed · 0 added · in 6.2s</ToolResult>
        <ToolCall name="Bash" args="npm run build" />
        <ToolResult>
          <span className={GREEN}>built in 11.4s</span>
          <span className="ml-2 text-white/55">no type errors</span>
        </ToolResult>
        <AssistantSay>Re-running the audit to confirm all three are cleared.</AssistantSay>
        <WorkingLine verb="Percolating" elapsed="2m 14s" tokens="8.1k" />
      </ClaudeShell>
    ),
  },
  {
    task: 'T-119',
    label: 'Add rate-limit headers to the public API',
    branch: 'api-rate-limit-headers',
    osc: 'Editing the route middleware…',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>429 and Retry-After on every public route.</ClaudeUser>
        <AssistantSay>The limiter already tracks the window; it just never writes the headers.</AssistantSay>
        <ToolCall name="Read" args="src/api/rateLimit.ts" />
        <ToolResult>Read 214 lines</ToolResult>
        <ToolCall name="Grep" args="res.setHeader · src/api" />
        <ToolResult>12 matches in 4 files</ToolResult>
        <ToolCall name="Edit" args="src/api/middleware.ts" />
        <Lines added={38} removed={4} />
        <EditDiff
          rows={[
            [88, '+', "res.setHeader('X-RateLimit-Limit', quota.max);"],
            [89, '+', "res.setHeader('X-RateLimit-Remaining', quota.left);"],
            [90, '+', 'if (quota.left === 0) {'],
            [91, '+', "  res.setHeader('Retry-After', quota.resetIn);"],
            [92, '+', '}'],
          ]}
        />
        <ToolCall name="Bash" args="npm test -- api/rateLimit" />
        <ToolResult>
          <span className={GREEN}>PASS</span>
          <span className="ml-2 text-white/65">22 tests</span>
          <span className="ml-2 text-white/35">in 1.8s</span>
        </ToolResult>
        <Continuation>covers the 429 body, the reset clock, and the burst allowance</Continuation>
        <AssistantSay>Wiring the same headers into the streaming routes.</AssistantSay>
        <WorkingLine verb="Finagling" elapsed="6m 02s" tokens="21.4k" />
      </ClaudeShell>
    ),
  },
  {
    task: 'T-121',
    label: 'Support SSO re-auth prompt',
    branch: 'sso-reauth-prompt',
    osc: 'Adding the freshness guard…',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>Re-prompt for SSO when the session is older than the tenant's limit.</ClaudeUser>
        <AssistantSay>Reading how the session age is tracked before I add the check.</AssistantSay>
        <ToolCall name="Read" args="src/account/session.ts" />
        <ToolResult>Read 388 lines</ToolResult>
        <ToolCall name="Grep" args="maxSessionAge · src" />
        <ToolResult>4 matches · all in the tenant schema</ToolResult>
        <AssistantSay>maxSessionAge is on the tenant, not the session — the check belongs in the guard.</AssistantSay>
        <ToolCall name="Write" args="src/account/reauth.ts" />
        <Lines added={52} note="lines (new)" />
        <EditDiff
          rows={[
            [12, '+', 'export function requireFreshSession(req, tenant) {'],
            [13, '+', '  const age = Date.now() - req.session.authAt;'],
            [14, '+', '  if (age < tenant.maxSessionAge) return null;'],
            [15, '+', '  return reauthRedirect(tenant.idp, req.url);'],
          ]}
        />
        <ToolCall name="Edit" args="src/account/guard.ts" />
        <Lines added={9} removed={1} />
        <Continuation>calls requireFreshSession ahead of every authenticated handler</Continuation>
        <WorkingLine verb="Cogitating" elapsed="4m 37s" tokens="15.9k" />
      </ClaudeShell>
    ),
  },
  {
    task: 'T-120',
    label: 'Fix flaky signup e2e',
    branch: 'fix-signup-e2e',
    osc: 'Running the suite…',
    body: (
      <ClaudeShell busy>
        <ClaudeUser>The signup e2e fails about one run in five. Find out why.</ClaudeUser>
        <AssistantSay>Running it in a loop first, so I can see how it fails rather than guess.</AssistantSay>
        <ToolCall name="Bash" args="npm run test:e2e -- signup --repeat 10" />
        <ToolResult>
          <span className={GREEN}>8 passed</span>
          <span className="mx-1.5 text-white/30">·</span>
          <span className={RED}>2 failed</span>
          <span className="ml-2 text-white/55">both on the same assertion</span>
        </ToolResult>
        <Continuation>expected "Check your inbox" · received ""</Continuation>
        <ToolCall name="Read" args="e2e/signup.test.ts" />
        <ToolResult>Read 96 lines</ToolResult>
        <AssistantSay>It asserts on the toast before the redirect settles. Waiting on the route instead.</AssistantSay>
        <ToolCall name="Edit" args="e2e/signup.test.ts" />
        <Lines added={14} removed={9} />
        <EditDiff
          rows={[
            [34, '-', "await expect(page.getByRole('status')).toHaveText("],
            [34, '+', "await page.waitForURL('**/signup/check-email');"],
            [35, '+', "await expect(page.getByRole('status')).toHaveText("],
          ]}
        />
        <ToolCall name="Bash" args="npm run test:e2e -- signup --repeat 20" />
        <WorkingLine verb="Wrangling" elapsed="11m 08s" tokens="34.2k" />
      </ClaudeShell>
    ),
  },
];

export const N = SESSIONS.length;

/** The stack's own geometry: what a back card peeks above the one in front,
 *  and how much it narrows. The app caps its depth ramp at four cards, so a
 *  deeper stack supplies its own rather than repeating the fourth. */
export const PEEK = 24;
/** Clearance above the deepest card. A shade over the desk's 36px padding,
 *  since the back cards narrow and read lighter than the front one. */
export const TOP_PAD = 44;
export const NARROW = 0.014;

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
                      summaryType="thinking"
                      isActive={front}
                      isBackCard={!front}
                      stackPosition={front ? undefined : rank}
                      nameContent={
                        <TerminalHeaderName
                          label={session.label}
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
