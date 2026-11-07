import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { HookRowView } from '../../ouijit-ui/components/scripts/HookRowView';
import { ScriptRowView } from '../../ouijit-ui/components/scripts/ScriptRowView';
import {
  ClaudeShell,
  ClaudeUser,
  AssistantSay,
  ToolCall,
  ToolResult,
  WorkingLine,
  BranchLabel,
  BODY_CLS,
} from './stackParts';
import { DeskWash } from './DeskWash';
import { MockScale } from './MockScale';

/**
 * The sandbox page's rows: each is the Plan section's copy-beside-desk row,
 * with the app's own terminal and settings chrome on the desk.
 */

const GREEN = 'text-[#3fb950]';
const RED = 'text-[#f85149]';

function Panel({ ledge, divided = false, children }: { ledge?: string; divided?: boolean; children: ReactNode }) {
  return (
    <div
      className="glass-bevel relative flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden w-full"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      {ledge && (
        <div className="pane-ledge relative z-[5] shrink-0 h-9 flex items-center px-4 text-[13px] text-ink/70">{ledge}</div>
      )}
      <div className={`flex flex-col ${divided ? 'divide-y divide-ink/[0.06]' : ''}`}>{children}</div>
    </div>
  );
}

function Terminal({
  height,
  status,
  label,
  osc,
  branch,
  children,
}: {
  height: number;
  status: string;
  label: string;
  osc?: string;
  branch: string;
  children: ReactNode;
}) {
  return (
    <div className="relative" style={{ height }}>
      <TerminalCardView isActive>
        <TerminalHeaderView
          status={status}
          sandboxed
          isActive
          nameContent={<TerminalHeaderName label={label} lastOscTitle={osc} />}
          branchContent={<BranchLabel branch={branch} />}
        />
        {children}
      </TerminalCardView>
    </div>
  );
}

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

/* ─── Held to its worktree ─────────────────────────────────────────── */

const GRANTS: { icon: string; label: string; state: string; blocked?: boolean }[] = [
  { icon: 'folder-open', label: 'Task worktree', state: 'Read · write' },
  { icon: 'git-branch', label: 'Git objects, refs, logs', state: 'Read · write' },
  { icon: 'git-branch', label: 'Git hooks and config', state: 'Read-only' },
  { icon: 'cube', label: 'Package cache', state: 'Read · write' },
  { icon: 'terminal', label: 'Status port', state: 'Open' },
  { icon: 'prohibit', label: 'Home, keys, other repos', state: 'Blocked', blocked: true },
  { icon: 'globe-simple', label: 'Network', state: 'Allowed' },
];

function Grants() {
  return (
    <Panel ledge="Reachable from T-119" divided>
      {GRANTS.map((g) => (
        <div key={g.label} className="flex items-center gap-2.5 px-3 py-2">
          <Icon name={g.icon} className={`w-3.5 h-3.5 shrink-0 ${g.blocked ? 'text-ansi-red/80' : 'text-ink/45'}`} />
          <span className="text-xs text-text-primary truncate">{g.label}</span>
          <span className={`ml-auto shrink-0 font-mono text-[11px] ${g.blocked ? 'text-ansi-red/90' : 'text-text-tertiary'}`}>
            {g.state}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function HeldToWorktree() {
  return (
    <div className="flex gap-5 items-start">
      <div className="flex-1 min-w-0">
        <Terminal
          height={430}
          status="thinking"
          label="Add rate-limit headers to the public API"
          osc="Running the load test…"
          branch="api-rate-limit-headers"
        >
          <ClaudeShell busy>
            <ClaudeUser>Add rate-limit headers to every public route.</ClaudeUser>
            <AssistantSay>Middleware first, then the router, then a load test against it.</AssistantSay>
            <ToolCall name="Write" args="src/api/middleware/rateLimit.ts" />
            <Lines added={48} note="lines (new)" />
            <ToolCall name="Edit" args="src/api/router.ts" />
            <Lines added={4} removed={1} />
            <ToolCall name="Bash" args="npm install -g artillery" />
            <ToolResult>
              <span className={RED}>EPERM: operation not permitted</span>
              <span className="ml-2 text-white/45">mkdir /usr/local/lib/node_modules/artillery</span>
            </ToolResult>
            <AssistantSay>No global installs from here. Running it out of the worktree instead.</AssistantSay>
            <ToolCall name="Bash" args="npx artillery quick --count 50 http://localhost:4000/api/health" />
            <WorkingLine verb="Hammering" elapsed="1m 02s" tokens="6.4k" />
          </ClaudeShell>
        </Terminal>
      </div>
      <div className="shrink-0" style={{ width: 272 }}>
        <Grants />
      </div>
    </div>
  );
}

/* ─── Where things run ─────────────────────────────────────────────── */

function Select({ value }: { value: string }) {
  return (
    <span className="w-[8.5rem] shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 text-sm bg-ink/[0.04] border border-ink/10 rounded-md text-text-primary">
      <span className="truncate">{value}</span>
      <Icon name="caret-down" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
    </span>
  );
}

function WhereThingsRun() {
  return (
    <Panel divided>
      <div className="flex items-center gap-4 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-text-primary">Default</div>
          <div className="text-[11px] text-text-tertiary mt-0.5">Where terminals, hooks and scripts run</div>
        </div>
        <Select value="Host" />
      </div>
      <HookRowView
        label="Start"
        description="Runs when a task moves to In Progress"
        command={'claude --dangerously-skip-permissions "$OUIJIT_TASK_DESCRIPTION"'}
        sandboxLabel="Sandbox"
      />
      <HookRowView label="Done" description="Runs when a task moves to Done" command="git push -u origin HEAD" />
      <ScriptRowView name="Dev server" command="npm run dev" />
    </Panel>
  );
}

/* ─── Still an agent in Ouijit ─────────────────────────────────────── */

const ACCESS = [
  { label: 'Read only', detail: 'Its task, the notes on its diff, drafts, and asking you', on: true },
  { label: 'Its own task', detail: 'Also move, rename and describe it' },
  { label: 'Everything', detail: 'What a host terminal can' },
];

function Radio({ on }: { on?: boolean }) {
  return (
    <span
      className={`w-3.5 h-3.5 shrink-0 rounded-full border flex items-center justify-center ${
        on ? 'border-accent bg-accent' : 'border-ink/30'
      }`}
    >
      {on && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
    </span>
  );
}

function CliAccess() {
  return (
    <Panel ledge="Ouijit CLI access" divided>
      {ACCESS.map((a) => (
        <div key={a.label} className="flex items-center gap-3 px-3 py-2.5">
          <Radio on={a.on} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-primary">{a.label}</div>
            <div className="text-[11px] text-text-tertiary mt-0.5">{a.detail}</div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function StillAnAgent() {
  return (
    <div className="flex gap-5 items-start">
      <div className="flex-1 min-w-0">
        <Terminal
          height={432}
          status="ready"
          label="Add rate-limit headers to the public API"
          branch="api-rate-limit-headers"
        >
          <ClaudeShell>
            <ToolCall name="Bash" args="ouijit diff notes" />
            <ToolResult>{'[{"path": "src/api/router.ts", "line": 41, "body": "Leave /health out of this."}]'}</ToolResult>
            <AssistantSay>Exempting the health route.</AssistantSay>
            <ToolCall name="Edit" args="src/api/router.ts" />
            <Lines added={1} removed={1} />
            <ToolCall
              name="Bash"
              args={'ouijit pr draft add 212 --file src/api/router.ts --line 41 --body "Health is exempt now."'}
            />
            <ToolResult>{'{"success": true}'}</ToolResult>
            <ToolCall name="Bash" args={'ouijit ask run -m "Pushing needs the deploy key" -- git push -u origin HEAD'} />
            <ToolResult>{'{"status": "pending"}'}</ToolResult>
            <AssistantSay>Health is exempt, the comment is staged, and the push is waiting on you.</AssistantSay>
          </ClaudeShell>
        </Terminal>
      </div>
      <div className="shrink-0" style={{ width: 272 }}>
        <CliAccess />
      </div>
    </div>
  );
}

/* ─── Fails closed ─────────────────────────────────────────────────── */

function FailsClosed() {
  return (
    <Terminal height={168} status="error" label="Harden session auth middleware" branch="harden-session-auth">
      <div className={BODY_CLS}>
        <div className={RED}>Sandbox failed to start: Landlock is unavailable on kernel 5.10 (needs 5.13 or newer).</div>
        <div className="mt-2 text-white/40">Nothing ran.</div>
      </div>
    </Terminal>
  );
}

/* ─── Bring your own ───────────────────────────────────────────────── */

function CustomLauncher() {
  return (
    <Panel>
      <div className="flex items-center gap-4 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-text-primary">Custom launcher</div>
          <div className="font-mono text-[11px] text-text-secondary mt-0.5 truncate">~/.local/bin/team-sandbox</div>
        </div>
        <button className="shrink-0 px-2 py-1 text-[11px] bg-transparent border-none text-text-tertiary">Change…</button>
      </div>
    </Panel>
  );
}

/* ─── The rows ─────────────────────────────────────────────────────── */

function Desk({ wash, children }: { wash?: string; children: ReactNode }) {
  return (
    <div className={`plan-desk desk-wash ${wash ? '' : 'desk-wash--graphite'}`}>
      <DeskWash style={wash ? ({ '--wash': wash } as CSSProperties) : undefined} />
      <div className="relative">{children}</div>
    </div>
  );
}

const ROWS: { title: string; body: ReactNode; width: number; wash?: string; Mock: () => ReactNode }[] = [
  {
    title: 'Held to its worktree',
    body: (
      <>
        The agent reads and writes the task's files and commits them. Your home directory, your keys and your
        other repositories are not there. The kernel enforces it, with Seatbelt on macOS and Landlock on Linux,
        in place, with nothing to boot and nothing to sync.
      </>
    ),
    width: 760,
    wash: 'var(--wash-iris)',
    Mock: HeldToWorktree,
  },
  {
    title: "The agent is sandboxed. The dev server isn't.",
    body: (
      <>
        Pick a default for the project, then send anything elsewhere: a hook, one run of it, a script, or one
        command in a longer line. The usual shape is the agent inside and everything that needs your credentials
        outside.
      </>
    ),
    width: 560,
    Mock: WhereThingsRun,
  },
  {
    title: 'Still an agent in Ouijit',
    body: (
      <>
        It keeps the <code>ouijit</code> command, on a token scoped to its project. It reads the notes you leave
        on its diff, stages comments for you to send, and asks you to run what it cannot. Widen that per project
        if you want to.
      </>
    ),
    width: 760,
    Mock: StillAnAgent,
  },
  {
    title: 'Fails closed',
    body: (
      <>
        If the sandbox cannot start, nothing runs. There is no fallback to the host, and the profile that sets
        the limits lives where the agent cannot write.
      </>
    ),
    width: 560,
    Mock: FailsClosed,
  },
  {
    title: 'Or bring your own',
    body: (
      <>
        A Custom launcher is a reviewed script that owns the boundary. Ouijit passes it the worktree, the git
        directories and the ports as hints and adds nothing of its own. The{' '}
        <a href="/docs/sandbox/">sandbox documentation</a> has the contract.
      </>
    ),
    width: 560,
    Mock: CustomLauncher,
  },
];

export function SandboxSection() {
  return (
    <div className="sandbox-rows">
      {ROWS.map(({ title, body, width, wash, Mock }) => (
        <div key={title} className="plan-v3-row" data-reveal="">
          <div className="plan-v3-copy">
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
          <div className="plan-v3-mock">
            <Desk wash={wash}>
              <MockScale width={width}>
                <Mock />
              </MockScale>
            </Desk>
          </div>
        </div>
      ))}
    </div>
  );
}
