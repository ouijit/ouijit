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

/**
 * The five sessions the Build section runs, and the geometry of the stack they
 * land in. Each transcript is the app's own terminal chrome, so nothing here
 * invents a visual language the product does not already draw.
 */

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
