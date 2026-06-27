/**
 * HTTP API server for Claude Code hook communication + hook installer.
 *
 * Hooks fire lifecycle events (Stop, UserPromptSubmit, Notification) which
 * hit this server via curl. The server forwards status updates to the
 * renderer so terminal cards show the correct busy/idle indicator.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { isPtyActive } from './ptyManager';
import { getShellIntegrationDir, installShellIntegration } from './shellIntegration';
import { getLogger } from './logger';
import { handleApiRequest } from './api/router';
import { authenticateRequest, type AuthContext } from './apiAuth';

const hookServerLog = getLogger().scope('hookServer');

let server: http.Server | null = null;
let apiPort = 0;
let mainWindow: BrowserWindow | null = null;

/** Get the port the hook server is listening on. */
export function getApiPort(): number {
  return apiPort;
}

// ── Hook status state (main-process, survives renderer reloads) ──────

export type HookStatus = 'thinking' | 'ready';

export interface HookStatusEntry {
  status: HookStatus;
  thinkingCount: number;
}

const hookStatusMap = new Map<string, HookStatusEntry>();
const planPathMap = new Map<string, string>();

/** Get the current hook status for a ptyId. Returns null if no hook activity. */
export function getHookStatus(ptyId: string): HookStatusEntry | null {
  return hookStatusMap.get(ptyId) ?? null;
}

/** Get the plan file path for a ptyId. Returns null if no plan detected. */
export function getPlanPath(ptyId: string): string | null {
  return planPathMap.get(ptyId) ?? null;
}

/** Clear hook status for a ptyId (call on PTY exit). */
export function clearHookStatus(ptyId: string): void {
  hookStatusMap.delete(ptyId);
  planPathMap.delete(ptyId);
}

/** Clear all hook statuses (call on app cleanup). */
export function clearAllHookStatuses(): void {
  hookStatusMap.clear();
  planPathMap.clear();
}

/**
 * Set the plan file path for a pty and notify the renderer.
 * Called by both the hook action handler and the REST API route.
 */
export function setPlanPath(ptyId: string, planPath: string): boolean {
  if (!isPtyActive(ptyId)) return false;
  planPathMap.set(ptyId, planPath);
  hookServerLog.info('plan set', { ptyId, planPath });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('claude-plan-detected', ptyId, planPath);
  }
  return true;
}

/**
 * Clear the plan file path for a pty and notify the renderer.
 *
 * Always notifies the renderer, even when planPathMap has no entry: the map is
 * in-memory only, so after an app restart it is empty while the renderer may
 * still display a previously-set plan. Notifying unconditionally lets a stale
 * renderer plan state get cleared.
 */
export function clearPlanPath(ptyId: string): boolean {
  const had = planPathMap.delete(ptyId);
  hookServerLog.info('plan cleared', { ptyId, had });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('claude-plan-detected', ptyId, null);
  }
  return had;
}

// ── Action handlers ──────────────────────────────────────────────────

type ActionHandler = (body: Record<string, unknown>, auth: AuthContext) => void;

const VALID_STATUSES = new Set<HookStatus>(['thinking', 'ready']);

const actionHandlers: Record<string, ActionHandler> = {
  status(body, _auth) {
    const { ptyId, status } = body;
    if (typeof ptyId !== 'string' || typeof status !== 'string') return;
    if (!VALID_STATUSES.has(status as HookStatus)) return;
    if (!isPtyActive(ptyId)) return;
    hookServerLog.info('status update', { ptyId, status });

    // Update main-process state map
    const entry = hookStatusMap.get(ptyId);
    if (status === 'thinking') {
      hookStatusMap.set(ptyId, {
        status: 'thinking',
        thinkingCount: (entry?.thinkingCount ?? 0) + 1,
      });
    } else {
      hookStatusMap.set(ptyId, {
        status: 'ready',
        thinkingCount: entry?.thinkingCount ?? 0,
      });
    }

    // Forward to renderer for real-time UI updates
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-hook-status', ptyId, status);
    }
  },

  plan(body, _auth) {
    const { ptyId, filename } = body;
    if (typeof ptyId !== 'string' || typeof filename !== 'string') return;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return;

    const planPath = path.join(os.homedir(), '.claude', 'plans', filename);
    setPlanPath(ptyId, planPath);
  },

  'plan-ready'(body, _auth) {
    const { ptyId } = body;
    if (typeof ptyId !== 'string') return;
    if (!isPtyActive(ptyId)) return;

    hookServerLog.info('plan ready', { ptyId });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude-plan-ready', ptyId);
    }
  },
};

// ── Server lifecycle ─────────────────────────────────────────────────

/**
 * Start the hook HTTP server. Call once at app init.
 * Returns a promise that resolves once the server is listening.
 */
export function startHookServer(window: BrowserWindow): Promise<void> {
  if (server) return Promise.resolve();
  mainWindow = window;

  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      // REST API for CLI
      if (req.url?.startsWith('/api/')) {
        handleApiRequest(req, res, window);
        return;
      }

      // Hook endpoint for Claude Code lifecycle events
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404);
        res.end();
        return;
      }

      // Any process on the host loopback (and every sandboxed VM via
      // host.lima.internal) can reach this endpoint. Require a valid
      // per-PTY bearer token so only legitimate hook scripts succeed.
      const auth = authenticateRequest(req.headers['authorization']);
      if (!auth) {
        res.writeHead(401);
        res.end();
        return;
      }

      let rawBody = '';
      req.on('data', (chunk: Buffer) => {
        rawBody += chunk.toString();
        // Limit body size (4KB is plenty)
        if (rawBody.length > 4096) {
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          const action = body.action;
          if (typeof action !== 'string') {
            // Unknown / missing action is a valid no-op so older hook
            // scripts don't fail against a newer server. Matches the
            // 200-on-unknown-action contract.
            res.writeHead(200);
            res.end();
            return;
          }
          const handler = actionHandlers[action];
          if (!handler) {
            res.writeHead(200);
            res.end();
            return;
          }
          // All registered actions require a ptyId. Reject a missing
          // or non-string value with 400 so misconfigured callers
          // notice rather than silently no-oping inside the handler.
          if (typeof body.ptyId !== 'string') {
            res.writeHead(400);
            res.end();
            return;
          }
          // Every hook action is scoped to the caller's own PTY. A
          // sandbox-scoped token for pty A must not be able to set
          // status or plan state on pty B — reject loudly with 403.
          if (body.ptyId !== auth.ptyId) {
            res.writeHead(403);
            res.end();
            return;
          }
          handler(body, auth);
          res.writeHead(200);
          res.end();
        } catch {
          res.writeHead(400);
          res.end();
        }
      });
    });

    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (addr && typeof addr === 'object') {
        apiPort = addr.port;
      }
      server = s;
      resolve();
    });
  });
}

/**
 * Stop the hook server. Call on app quit.
 * Destroys active connections so in-flight requests don't delay shutdown.
 */
export function stopHookServer(): Promise<void> {
  if (!server) return Promise.resolve();
  const s = server;
  server = null;
  return new Promise((resolve) => {
    // Close the server and destroy any lingering sockets
    s.close(() => resolve());
    s.closeAllConnections();
  });
}

// ── Hook definitions ─────────────────────────────────────────────────

/** Path where wrapper and helper scripts are installed. */
export function getWrapperBinDir(): string {
  return path.join(os.homedir(), '.config', 'Ouijit', 'bin');
}

/** Path to the CLI reference file loaded by Claude via --append-system-prompt-file. */
export function getCliReferencePath(): string {
  return path.join(os.homedir(), '.config', 'Ouijit', 'ouijit-cli-reference.md');
}

interface HookEntry {
  type: 'command';
  command: string;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

/** Build hook settings for a given ouijit-hook command path. */
function buildHookSettings(hookCmd: string, planHookCmd: string): { hooks: Record<string, HookMatcher[]> } {
  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${hookCmd} status status=thinking` }] }],
      PostToolUse: [
        { hooks: [{ type: 'command', command: `${hookCmd} status status=thinking` }] },
        { matcher: 'Write|Edit', hooks: [{ type: 'command', command: planHookCmd }] },
        { matcher: 'ExitPlanMode', hooks: [{ type: 'command', command: `${hookCmd} plan-ready` }] },
      ],
      Stop: [{ hooks: [{ type: 'command', command: `${hookCmd} status status=ready` }] }],
      Notification: [
        {
          matcher: 'permission_prompt|idle_prompt',
          hooks: [{ type: 'command', command: `${hookCmd} status status=ready` }],
        },
      ],
    },
  };
}

// ── Hook installer ───────────────────────────────────────────────────

// Safe pattern: alphanumeric, hyphens, dots, underscores
const SAFE_VALUE = '[a-zA-Z0-9._-]+';

export const PLAN_HOOK_SCRIPT = [
  '#!/bin/bash',
  '# Ouijit plan detection hook for PostToolUse (Write|Edit)',
  '# Reads stdin JSON, checks if a plan file was written, notifies the server.',
  '[ -z "$OUIJIT_API_URL" ] && exit 0',
  '[ -z "$OUIJIT_API_TOKEN" ] && exit 0',
  '[[ "$OUIJIT_PTY_ID" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 0',
  '',
  '# Stream stdin through grep to find plan file path (avoids buffering full content)',
  'plan_file=$(grep -o \'"[^"]*/.claude/plans/[^"]*\\.md"\' | head -1 | tr -d \'"\')',
  '[ -z "$plan_file" ] && exit 0',
  '',
  'filename=$(basename "$plan_file")',
  '[[ "$filename" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 0',
  '',
  'curl -sf -o /dev/null -X POST "$OUIJIT_API_URL/hook" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Authorization: Bearer $OUIJIT_API_TOKEN" \\',
  '  -d "{\\"ptyId\\":\\"$OUIJIT_PTY_ID\\",\\"action\\":\\"plan\\",\\"filename\\":\\"$filename\\"}" 2>/dev/null &',
  '',
].join('\n');

export const HELPER_SCRIPT = [
  '#!/bin/bash',
  '# Ouijit API client for Claude Code hooks',
  '# Usage: ouijit-hook <action> [key=value ...]',
  '[ -z "$OUIJIT_API_URL" ] && exit 0',
  '[ -z "$OUIJIT_API_TOKEN" ] && exit 0',
  '',
  '# Validate inputs to prevent malformed JSON',
  `[[ "$OUIJIT_PTY_ID" =~ ^${SAFE_VALUE}$ ]] || exit 0`,
  'action="$1"; shift',
  `[[ "$action" =~ ^${SAFE_VALUE}$ ]] || exit 0`,
  '',
  'json="\\"ptyId\\":\\"$OUIJIT_PTY_ID\\",\\"action\\":\\"$action\\""',
  'for arg in "$@"; do',
  '  key="${arg%%=*}"; val="${arg#*=}"',
  `  [[ "$key" =~ ^${SAFE_VALUE}$ ]] || continue`,
  `  [[ "$val" =~ ^${SAFE_VALUE}$ ]] || continue`,
  '  json="$json,\\"$key\\":\\"$val\\""',
  'done',
  '',
  'curl -sf -o /dev/null -X POST "$OUIJIT_API_URL/hook" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Authorization: Bearer $OUIJIT_API_TOKEN" \\',
  '  -d "{$json}" 2>/dev/null &',
  '',
].join('\n');

/** CLI reference loaded by Claude Code via --append-system-prompt-file. */
export const CLI_REFERENCE = `# Ouijit CLI Reference

You are running inside an Ouijit terminal. The \`ouijit\` CLI manages tasks, tags, hooks, scripts, and plans for this project. All commands output JSON to stdout. The CLI is pre-configured via environment variables — no setup needed.

## Environment (pre-set, do not modify)
- OUIJIT_API_URL — REST API endpoint (already configured)
- OUIJIT_PTY_ID — this terminal session's ID (used by plan commands)

## Task Commands (most common)
ouijit task list                              # → [{taskNumber, name, status, branch, worktreePath, prompt, ...}]
ouijit task get <number>                      # → single task object
ouijit task current                           # → task owning this terminal (resolves via OUIJIT_PTY_ID)
ouijit task create "<name>"                   # → {success, task: {taskNumber, ...}}
ouijit task create "<name>" --prompt "<text>" # set description at creation
ouijit task start <number>                    # creates git worktree, sets in_progress; default opens the start-hook dialog in the GUI
ouijit task start <number> --branch <name>    # use a custom branch name for the worktree
ouijit task start <number> --run-hook         # run the configured start hook immediately, no dialog
ouijit task start <number> --skip-hook        # spawn the terminal but run no hook
ouijit task start <number> --hook-command "<cmd>"  # spawn the terminal running a one-off command instead of the configured hook
ouijit task create-and-start "<name>"         # create + start in one step (accepts --prompt, --branch, and the same --run-hook / --skip-hook / --hook-command flags); aliased as "task spawn"
ouijit task set-status <number> <status>      # status: todo | in_progress | in_review | done
ouijit task set-status <number> in_review                    # default: opens the review-hook dialog (like a kanban drop)
ouijit task set-status <number> in_review --run-hook         # run the configured review hook immediately, no dialog
ouijit task set-status <number> in_review --skip-hook        # change status, run no hook
ouijit task set-status <number> in_review --hook-command "<cmd>" # run a one-off command instead of the review hook
ouijit task set-status <number> done                         # default: opens the done-hook dialog (like a kanban drop)
ouijit task set-status <number> done --run-hook              # run the configured done hook immediately, no dialog
ouijit task set-status <number> done --skip-hook            # change status, run no hook
ouijit task set-status <number> done --hook-command "<cmd>" # run a one-off command instead of the done hook
ouijit task bulk-set-status <status> <n1> <n2>...           # set status on many tasks in parallel (in_progress/in_review/done all take --run-hook/--skip-hook/--hook-command)
ouijit task set-name <number> <new name>
ouijit task set-description <number> <text>
ouijit task set-merge-target <number> <branch>
ouijit task delete <number>                   # removes task and its worktree

## Tag Commands
ouijit tag list                               # → all tags across projects
ouijit tag list --task <number>               # → tags for one task
ouijit tag add <task-number> <tag-name>
ouijit tag remove <task-number> <tag-name>
ouijit tag set <task-number> <tag1> <tag2>... # replace all tags

## Hook Commands (project lifecycle scripts)
Hook types: start, continue, run, review, done, editor

ouijit hook list                              # → {start?: {name, command}, ...}
ouijit hook get <type>
ouijit hook set <type> --name "<name>" --command "<cmd>" [--description "<desc>"]
ouijit hook delete <type>

## Script Commands (ad-hoc project scripts)
ouijit script list                            # → [{id, name, command, sortOrder}]
ouijit script set --name "<name>" --command "<cmd>"
ouijit script run <id-or-name>                # executes and streams output
ouijit script run <id-or-name> --task <number> # run in task's worktree dir

## Plan Commands (terminal session plan files)
ouijit plan set <path.md>                     # associate plan file with this terminal
ouijit plan get                               # → {ptyId, planPath}
ouijit plan unset                             # clear plan association

## Project Commands
ouijit project list                           # → all registered projects

## Key Behaviors
- All mutating commands notify the Ouijit app UI in real-time.
- Task statuses: todo → in_progress → in_review → done (set any directly).
- "start" creates a git worktree branch — the task gets its own isolated directory.
- Project is auto-detected from the current git repo. Override with --project <path>.
- Errors return JSON to stderr: {"error": "message"} with non-zero exit code.
- Always prefer ouijit over editing task files directly.

## Common Workflows
# Update the task owning this terminal:
ouijit task current
ouijit task set-status $(ouijit task current | jq .taskNumber) in_review

# Create a task and immediately start working:
ouijit task create-and-start "Fix auth timeout" --prompt "Session expires too early"

# Headless start — no GUI dialog needed. Use these when a human isn't at the keyboard
# to dismiss the start-hook dialog. The flags are mutually exclusive.
ouijit task start 5 --skip-hook
ouijit task start 5 --run-hook
ouijit task start 5 --hook-command "claude"

# Tag and describe a task:
ouijit task set-description 3 "Refactor the auth middleware to use JWT refresh tokens"
ouijit tag add 3 refactor
ouijit tag add 3 auth

# Set up a project run hook:
ouijit hook set run --name "Dev server" --command "npm run dev"
`;

/**
 * Bash snippet that resolves the real `${binaryName}` binary on PATH while
 * defending against exec'ing back into this wrapper. Shared by the claude,
 * codex, and pi wrappers (all of which install into `~/.config/Ouijit/bin`
 * and shadow a tool of the same name on PATH).
 *
 * Defines (on success): `WRAPPER_DIR`, `WRAPPER_SELF`, `CLEAN_PATH`, `REAL_BIN`,
 * and re-exports `PATH` with the wrapper dir kept in front so the ouijit CLI
 * stays reachable inside the agent's subshells.
 *
 * The string `:$WRAPPER_DIR:` substitution alone isn't enough — if PATH spells
 * the wrapper dir twice with even a slight difference (trailing slash, symlink
 * target, normalised vs raw) the strip silently misses one copy and we exec
 * ourselves. Each recursion appends a few KB of injected `-c` / `--settings`
 * overrides to argv until execve hits ARG_MAX and fails with E2BIG (T-407).
 * Comparing candidates by inode (`-ef`) collapses every spelling onto the same
 * identity check.
 */
function buildWrapperResolver(binaryName: string): string {
  return [
    'WRAPPER_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'WRAPPER_SELF="$WRAPPER_DIR/$(basename "$0")"',
    'CLEAN_PATH=":$PATH:"',
    'CLEAN_PATH="${CLEAN_PATH//:$WRAPPER_DIR:/:}"',
    'CLEAN_PATH="${CLEAN_PATH#:}"',
    'CLEAN_PATH="${CLEAN_PATH%:}"',
    '',
    `REAL_BIN="$(PATH="$CLEAN_PATH" command -v ${binaryName} 2>/dev/null)"`,
    'if [ -n "$REAL_BIN" ] && [ "$REAL_BIN" -ef "$WRAPPER_SELF" ]; then',
    '  REAL_BIN=""',
    'fi',
    'if [ -z "$REAL_BIN" ]; then',
    '  _IFS="$IFS"; IFS=":"',
    '  for _dir in $CLEAN_PATH; do',
    '    [ -z "$_dir" ] && continue',
    `    if [ -x "$_dir/${binaryName}" ] && [ ! "$_dir/${binaryName}" -ef "$WRAPPER_SELF" ]; then`,
    `      REAL_BIN="$_dir/${binaryName}"`,
    '      break',
    '    fi',
    '  done',
    '  IFS="$_IFS"; unset _IFS _dir',
    'fi',
    'if [ -z "$REAL_BIN" ]; then',
    `  echo "ouijit: ${binaryName} not found on PATH (or only the Ouijit wrapper was found)" >&2`,
    '  exit 1',
    'fi',
    '',
    '# Re-export PATH so the ouijit CLI is reachable from inside the agent.',
    'export PATH="$WRAPPER_DIR:$CLEAN_PATH"',
  ].join('\n');
}

/** Bash wrapper that shadows `claude` and injects hook settings via --settings. */
export const CLAUDE_WRAPPER = [
  '#!/bin/bash',
  '# Ouijit claude wrapper — injects hook settings at invocation time.',
  buildWrapperResolver('claude'),
  '',
  '# Claude subcommands (mcp, update, doctor, config, install, plugin, ...)',
  '# do not accept top-level flags like --settings / --append-system-prompt-file.',
  '# Injecting them either errors out or reroutes the subcommand name into an',
  '# interactive prompt (same shape as the Pi bug in issue #177). Detect the',
  '# first non-flag arg and, if it names a known subcommand, exec the real',
  '# claude without injection.',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -*) continue ;;',
  '    mcp|update|doctor|config|install|plugin|project|agents|setup-token|migrate-installer|ultrareview|auth)',
  '      exec "$REAL_BIN" "$@"',
  '      ;;',
  '    *) break ;;',
  '  esac',
  'done',
  '',
  '# CLI reference file for Claude Code agents',
  'REFERENCE_FILE="$HOME/.config/Ouijit/ouijit-cli-reference.md"',
  '',
  '# If ouijit is not running, just exec the real claude with CLI awareness',
  'if [ -z "$OUIJIT_API_URL" ]; then',
  '  exec "$REAL_BIN" --append-system-prompt-file "$REFERENCE_FILE" "$@"',
  'fi',
  '',
  '# Inject ouijit hooks via --settings (merges with user settings at runtime)',
  `exec "$REAL_BIN" --settings '${JSON.stringify(buildHookSettings('$HOME/.config/Ouijit/bin/ouijit-hook', '$HOME/.config/Ouijit/bin/ouijit-plan-hook'))}' --append-system-prompt-file "$REFERENCE_FILE" "$@"`,
  '',
].join('\n');

// ── Codex wrapper ────────────────────────────────────────────────────
// Codex has no `--settings` / `--append-system-prompt-file` flags, so the
// wrapper injects everything via `codex -c key=value` config overrides
// (where the value is parsed as TOML, falling back to a raw string):
//   • developer_instructions — the Ouijit CLI reference, surfaced as a
//     `developer` role message (appends; does NOT replace base instructions
//     like model_instructions_file would). The markdown isn't valid TOML, so
//     it's kept as a string — exactly the type this key wants.
//   • hooks.{UserPromptSubmit,PostToolUse,Stop,PermissionRequest} — Codex's
//     lifecycle-hook engine (stable, on by default). UserPromptSubmit /
//     PostToolUse → thinking; Stop / PermissionRequest → ready. Same status
//     mapping as the claude wrapper. The values are TOML arrays of inline
//     tables; commands run via the user's shell, so $HOME stays literal.
//     (We can't mark these `async = true` — Codex skips async hooks with a
//     warning today. ouijit-hook itself backgrounds its `curl` and exits in
//     milliseconds, so sync is fine.)
//   • notify — Codex's older, always-on turn-complete notifier; also mapped
//     to status=ready (a harmless fallback if the hooks engine is disabled).
//     Codex runs `notify[0] notify[1..] <json>` with no shell, so we wrap it
//     as ["bash","-c","<cmd>"] — bash expands $HOME and the trailing JSON
//     payload becomes $0 (ignored).
//   • hooks.state."<key>".trusted_hash — pre-trust each hook so Codex doesn't
//     gate it behind the `/hooks` review prompt on every fresh session. The
//     hash mirrors codex-rs/hooks/src/engine/discovery.rs:command_hook_hash:
//     sha256 of canonical JSON of the normalized hook identity. If a future
//     Codex changes the normalization our hash mismatches → trust_status is
//     `Modified` → hook is skipped just like an untrusted hook, and the user
//     falls back to the same one-time `/hooks` approval as before. Graceful.

/** Path to ouijit-hook with literal $HOME (expanded by whatever shell runs it). */
const CODEX_OUIJIT_HOOK = '$HOME/.config/Ouijit/bin/ouijit-hook';

/** SessionFlags layer source path Codex synthesizes for `-c` overrides (see discovery.rs). */
const CODEX_SESSION_FLAGS_PATH = '/<session-flags>/config.toml';

/**
 * Lifecycle hook events Codex exposes that we map to a status. Each entry is
 * `[event_name, status, event_snake]`. `event_snake` matches `hook_event_key_label`
 * in codex-rs and is what Codex uses inside the persisted hook key.
 */
const CODEX_STATUS_HOOKS: ReadonlyArray<readonly [event: string, status: 'thinking' | 'ready', eventSnake: string]> = [
  ['UserPromptSubmit', 'thinking', 'user_prompt_submit'],
  ['PostToolUse', 'thinking', 'post_tool_use'],
  ['Stop', 'ready', 'stop'],
  ['PermissionRequest', 'ready', 'permission_request'],
];

function codexHookCommand(hookPath: string, status: 'thinking' | 'ready'): string {
  return `${hookPath} status status=${status}`;
}

/** TOML array-of-one-inline-table value for a single Codex `hooks.<Event>` entry (one command hook). */
function codexHookEventValue(hookPath: string, status: 'thinking' | 'ready'): string {
  return `[{hooks=[{type="command",command="${codexHookCommand(hookPath, status)}"}]}]`;
}

/** TOML/JSON array value for Codex's `notify` config — a shell wrapper that ignores the trailing payload arg. */
function codexNotifyValue(hookPath: string): string {
  return JSON.stringify(['bash', '-c', codexHookCommand(hookPath, 'ready')]);
}

/**
 * Build the persisted hook key Codex uses for a single command hook in our
 * single-group/single-handler layout: `<source>:<event_snake>:0:0`.
 */
function codexHookStateKey(source: string, eventSnake: string): string {
  return `${source}:${eventSnake}:0:0`;
}

/**
 * Canonical JSON: recursively sort object keys, no whitespace. Mirrors
 * codex-rs/config/src/fingerprint.rs:canonical_json + serde_json::to_vec.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/**
 * Compute the `current_hash` Codex expects in `hooks.state.<key>.trusted_hash`
 * for one of our command hooks. Mirrors `command_hook_hash` in
 * codex-rs/hooks/src/engine/discovery.rs:
 *
 *   identity = { event_name, matcher (skipped when None), hooks: [normalized] }
 *   normalized = { type:"command", command, commandWindows (skipped when None),
 *                  timeout (default 600), async:false, statusMessage (skipped) }
 *   hash = sha256(canonical_json(identity))
 *
 * None-valued Options are skipped by toml::Serializer (TOML has no null) and so
 * don't appear in the JSON Codex hashes.
 */
function codexHookTrustHash(eventSnake: string, command: string): string {
  const identity = {
    event_name: eventSnake,
    hooks: [{ type: 'command', command, timeout: 600, async: false }],
  };
  const hex = createHash('sha256').update(canonicalJson(identity)).digest('hex');
  return `sha256:${hex}`;
}

/** Bash wrapper that shadows `codex` and injects the CLI reference + status hooks via `-c` overrides. */
export const CODEX_WRAPPER = [
  '#!/bin/bash',
  '# Ouijit codex wrapper — injects the Ouijit CLI reference and status',
  '# hooks via `-c` config overrides (Codex has no --settings flag).',
  buildWrapperResolver('codex'),
  '',
  '# Ouijit CLI reference file — surfaced via developer_instructions',
  'REFERENCE_FILE="$HOME/.config/Ouijit/ouijit-cli-reference.md"',
  '',
  '# If ouijit is not running, just exec the real codex with CLI awareness',
  'if [ -z "$OUIJIT_API_URL" ]; then',
  '  exec "$REAL_BIN" -c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"',
  'fi',
  '',
  'exec "$REAL_BIN" \\',
  '  -c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)" \\',
  ...CODEX_STATUS_HOOKS.flatMap(([event, status, eventSnake]) => {
    const cmd = codexHookCommand(CODEX_OUIJIT_HOOK, status);
    const stateKey = codexHookStateKey(CODEX_SESSION_FLAGS_PATH, eventSnake);
    const hash = codexHookTrustHash(eventSnake, cmd);
    return [
      `  -c 'hooks.${event}=${codexHookEventValue(CODEX_OUIJIT_HOOK, status)}' \\`,
      `  -c 'hooks.state."${stateKey}".trusted_hash="${hash}"' \\`,
    ];
  }),
  `  -c 'notify=${codexNotifyValue(CODEX_OUIJIT_HOOK)}' \\`,
  '  "$@"',
  '',
].join('\n');

// ── Pi wrapper ───────────────────────────────────────────────────────
// Pi exposes lifecycle events only to TypeScript extensions, not as
// shell-command hooks. We ship a tiny extension and load it via
// `pi --extension <path>`; the same source auto-discovers in the sandbox
// VM. OUIJIT_HOOK_BIN (set by the wrapper / VM init) carries the path to
// ouijit-hook so the extension source is identical in both contexts.

export function getPiExtensionPath(): string {
  return path.join(os.homedir(), '.config', 'Ouijit', 'pi', 'ouijit-extension.ts');
}

export const PI_EXTENSION = `// Ouijit Pi extension — bridges Pi turn events to the per-terminal
// status indicator. Auto-installed; safe to delete (Ouijit recreates it).
// No-ops when OUIJIT_HOOK_BIN is unset, so it's harmless outside Ouijit.

type OuijitStatus = 'thinking' | 'ready';

interface OuijitPiApi {
  on(event: string, handler: () => void): void;
  exec(command: string, args: string[], options?: { timeout?: number }): Promise<unknown>;
}

export default async (pi: OuijitPiApi) => {
  const hookBin = process.env.OUIJIT_HOOK_BIN;
  if (!hookBin) return;

  const ping = (status: OuijitStatus) => {
    pi.exec(hookBin, ['status', \`status=\${status}\`], { timeout: 2000 }).catch(() => {});
  };

  pi.on('agent_start', () => ping('thinking'));
  pi.on('agent_end', () => ping('ready'));
};
`;

export const PI_WRAPPER = [
  '#!/bin/bash',
  '# Ouijit pi wrapper — loads the ouijit-extension Pi extension so',
  '# turn-complete events surface as terminal status updates.',
  buildWrapperResolver('pi'),
  '',
  '# Pi subcommands run in their own non-interactive mode. Injecting',
  '# --append-system-prompt / --extension forces Pi back into an interactive',
  '# session, swallowing the subcommand (see issue #177). Detect the first',
  '# non-flag arg and, if it names a known subcommand, exec the real pi',
  '# without injection.',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -*) continue ;;',
  '    install|remove|uninstall|update|list|config)',
  '      exec "$REAL_BIN" "$@"',
  '      ;;',
  '    *) break ;;',
  '  esac',
  'done',
  '',
  'REFERENCE_FILE="$HOME/.config/Ouijit/ouijit-cli-reference.md"',
  'EXTENSION_FILE="$HOME/.config/Ouijit/pi/ouijit-extension.ts"',
  'HOOK_BIN="$HOME/.config/Ouijit/bin/ouijit-hook"',
  '',
  'if [ -z "$OUIJIT_API_URL" ]; then',
  '  exec "$REAL_BIN" --append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"',
  'fi',
  '',
  '# OUIJIT_HOOK_BIN is read by the extension to shell out to ouijit-hook.',
  'OUIJIT_HOOK_BIN="$HOOK_BIN" exec "$REAL_BIN" \\',
  '  --append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)" \\',
  '  --extension "$EXTENSION_FILE" \\',
  '  "$@"',
  '',
].join('\n');

// ── opencode plugin + wrapper ────────────────────────────────────────
// opencode exposes lifecycle events only to JS/TS plugins, and it has no
// --append-system-prompt / hook CLI flag. Status and the CLI reference are
// injected two different ways:
//   • Status plugin: written into opencode's auto-load dir
//     (~/.config/opencode/plugins), which opencode imports directly at
//     startup. This is the only mechanism that works on released opencode:
//     a `plugin` entry in config (even an absolute path) is instead treated
//     as an npm package and `bun add`-ed, which fails for a local file. The
//     plugin loads for every opencode session but is a no-op unless
//     OUIJIT_HOOK_BIN is set (only the wrapper sets it), so a plain
//     `opencode` run is unaffected.
//   • CLI reference: rides on OPENCODE_CONFIG_CONTENT, an env var opencode
//     parses as JSON and merges additively into the resolved config. Its
//     `instructions` array concatenates onto the user's (never replaces).

/** opencode's global plugin auto-load directory. */
export function getOpencodePluginDir(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'plugins');
}

/** Path to the ouijit opencode status plugin. */
export function getOpencodePluginPath(): string {
  return path.join(getOpencodePluginDir(), 'ouijit.ts');
}

export const OPENCODE_PLUGIN = `// Ouijit opencode plugin - bridges opencode session status to the
// per-terminal status indicator. Auto-installed; safe to delete (Ouijit
// recreates it). No-ops when OUIJIT_HOOK_BIN is unset, so it is harmless if
// it ever loads outside Ouijit.

type OuijitStatus = 'thinking' | 'ready';

interface OuijitShellResult {
  quiet(): { nothrow(): Promise<unknown> };
}

interface OuijitOpencodeContext {
  $: (strings: TemplateStringsArray, ...values: unknown[]) => OuijitShellResult;
}

interface OuijitSessionEvent {
  type: string;
  properties?: { status?: { type?: string } };
}

export const OuijitStatusPlugin = async ({ $ }: OuijitOpencodeContext) => {
  const hookBin = process.env.OUIJIT_HOOK_BIN;
  if (!hookBin) return {};

  // Only report real transitions so we don't spawn a hook process per event.
  let last: OuijitStatus | null = null;
  const ping = (status: OuijitStatus) => {
    if (status === last) return;
    last = status;
    try {
      $\`\${hookBin} status status=\${status}\`.quiet().nothrow().catch(() => {});
    } catch {
      // best-effort: never let status reporting break the session
    }
  };

  return {
    // session.status carries opencode's busy/idle state (session.idle is
    // deprecated). status.type is 'busy' | 'retry' | 'idle'; anything that is
    // not idle means the agent is still working.
    event: async ({ event }: { event: OuijitSessionEvent }) => {
      if (event?.type !== 'session.status') return;
      ping(event.properties?.status?.type === 'idle' ? 'ready' : 'thinking');
    },
  };
};
`;

export const OPENCODE_WRAPPER = [
  '#!/bin/bash',
  '# Ouijit opencode wrapper - injects the Ouijit CLI reference via',
  '# OPENCODE_CONFIG_CONTENT (opencode parses it as JSON and merges it into',
  '# the resolved config; `instructions` concatenates onto the user config).',
  '# The status plugin is loaded separately from opencode auto-load dir; this',
  '# wrapper only flips it on by exporting OUIJIT_HOOK_BIN. opencode has no',
  '# system-prompt or hook CLI flags, so everything rides on env + config.',
  buildWrapperResolver('opencode'),
  '',
  '# opencode utility subcommands do not start an agent session. Run them',
  '# untouched so config injection never interferes (mirrors the claude and',
  '# pi subcommand guards).',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    -*) continue ;;',
  '    auth|models|upgrade|uninstall|stats|mcp|serve|github|export|import|debug|agent|session|db|plugin)',
  '      exec "$REAL_BIN" "$@"',
  '      ;;',
  '    *) break ;;',
  '  esac',
  'done',
  '',
  'REFERENCE_FILE="$HOME/.config/Ouijit/ouijit-cli-reference.md"',
  'HOOK_BIN="$HOME/.config/Ouijit/bin/ouijit-hook"',
  '',
  '# Add the CLI reference to opencode instructions for this invocation only.',
  'OUIJIT_OPENCODE_CONFIG="{\\"instructions\\":[\\"$REFERENCE_FILE\\"]}"',
  '',
  '# If ouijit is not running, still surface the CLI reference but leave the',
  '# status plugin inert (OUIJIT_HOOK_BIN unset).',
  'if [ -z "$OUIJIT_API_URL" ]; then',
  '  OPENCODE_CONFIG_CONTENT="$OUIJIT_OPENCODE_CONFIG" exec "$REAL_BIN" "$@"',
  'fi',
  '',
  '# OUIJIT_HOOK_BIN activates the ouijit status plugin (loaded from opencode',
  '# auto-load dir); it shells out to ouijit-hook on session.status busy/idle.',
  'OPENCODE_CONFIG_CONTENT="$OUIJIT_OPENCODE_CONFIG" OUIJIT_HOOK_BIN="$HOOK_BIN" exec "$REAL_BIN" "$@"',
  '',
].join('\n');

/**
 * Install the ouijit-hook helper script and claude wrapper into
 * ~/.config/Ouijit/bin/. The wrapper injects hooks via --settings
 * at invocation time so we never touch ~/.claude/settings.json.
 */
export function installWrapper(): void {
  try {
    const binDir = getWrapperBinDir();
    fs.mkdirSync(binDir, { recursive: true });

    // Write CLI reference file (loaded by claude via --append-system-prompt-file)
    fs.writeFileSync(getCliReferencePath(), CLI_REFERENCE, { mode: 0o644 });

    // Write ouijit-hook helper script (curl client invoked by hooks)
    fs.writeFileSync(path.join(binDir, 'ouijit-hook'), HELPER_SCRIPT, { mode: 0o755 });

    // Write ouijit-plan-hook script (detects plan file writes from PostToolUse stdin)
    fs.writeFileSync(path.join(binDir, 'ouijit-plan-hook'), PLAN_HOOK_SCRIPT, { mode: 0o755 });

    // Write claude wrapper script (shadows `claude` to inject --settings)
    fs.writeFileSync(path.join(binDir, 'claude'), CLAUDE_WRAPPER, { mode: 0o755 });

    // Write codex wrapper script (shadows `codex` to inject -c config overrides)
    fs.writeFileSync(path.join(binDir, 'codex'), CODEX_WRAPPER, { mode: 0o755 });

    // Write pi wrapper and the extension it loads via --extension. The
    // extension lives outside bin/ (not on PATH) and outside Pi's
    // auto-discovery roots (no effect on un-wrapped `pi` invocations).
    fs.writeFileSync(path.join(binDir, 'pi'), PI_WRAPPER, { mode: 0o755 });
    const piExtPath = getPiExtensionPath();
    fs.mkdirSync(path.dirname(piExtPath), { recursive: true });
    fs.writeFileSync(piExtPath, PI_EXTENSION, { mode: 0o644 });

    // Write opencode wrapper (shadows `opencode`) and the status plugin into
    // opencode's auto-load dir. opencode imports auto-load files directly,
    // whereas a `plugin` config entry is `bun add`-ed (fails for a local
    // file), so the auto-load dir is the only working host mechanism. The
    // plugin is inert until the wrapper exports OUIJIT_HOOK_BIN, so a plain
    // `opencode` run is unaffected.
    fs.writeFileSync(path.join(binDir, 'opencode'), OPENCODE_WRAPPER, { mode: 0o755 });
    const opencodePluginPath = getOpencodePluginPath();
    fs.mkdirSync(path.dirname(opencodePluginPath), { recursive: true });
    fs.writeFileSync(opencodePluginPath, OPENCODE_PLUGIN, { mode: 0o644 });

    // Write ouijit CLI wrapper (delegates to the bundled CLI JS via env vars set by PTY manager)
    fs.writeFileSync(
      path.join(binDir, 'ouijit'),
      [
        '#!/bin/bash',
        '# Ouijit CLI — auto-installed by the Ouijit app',
        'if [ -z "$OUIJIT_CLI_PATH" ] || [ ! -f "$OUIJIT_CLI_PATH" ]; then',
        '  echo "ouijit: CLI not available (run from an Ouijit terminal)" >&2',
        '  exit 1',
        'fi',
        'exec node "$OUIJIT_CLI_PATH" "$@"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    // Write per-shell integration scripts (re-fix PATH after shell init,
    // emit OSC 133 exit codes). Each provider owns its own files.
    installShellIntegration(getShellIntegrationDir());
  } catch (err) {
    hookServerLog.warn('failed to install wrapper', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * One-time migration: remove Ouijit hook entries from ~/.claude/settings.json
 * left by the old installHooks() approach. Guarded by a sentinel file so it
 * only runs once per user.
 */
export function migrateFromSettingsHooks(): void {
  try {
    const configDir = path.join(os.homedir(), '.config', 'Ouijit');
    const sentinelPath = path.join(configDir, '.migrated-to-wrapper');

    // Already migrated — skip
    if (fs.existsSync(sentinelPath)) return;

    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>> | undefined;
      if (hooks) {
        let changed = false;
        for (const event of Object.keys(hooks)) {
          const filtered = hooks[event].filter(
            (entry) => !entry.hooks?.some((h) => h.command?.includes('ouijit-hook')),
          );
          if (filtered.length !== hooks[event].length) {
            changed = true;
            if (filtered.length === 0) {
              delete hooks[event];
            } else {
              hooks[event] = filtered;
            }
          }
        }
        if (Object.keys(hooks).length === 0) {
          delete settings.hooks;
        }
        if (changed) {
          const tmpPath = settingsPath + '.tmp';
          fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
          fs.renameSync(tmpPath, settingsPath);
          hookServerLog.info('migrated: removed old ouijit hooks from ~/.claude/settings.json');
        }
      }
    } catch {
      // settings.json doesn't exist or is invalid — nothing to clean up
    }

    // Also remove stale version marker from old approach
    try {
      fs.unlinkSync(path.join(configDir, 'hooks-version'));
    } catch {
      /* already gone */
    }

    // Write sentinel so we don't run this again
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(sentinelPath, '', 'utf-8');
  } catch (err) {
    hookServerLog.warn('migration failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ── VM hook injection ────────────────────────────────────────────────
// Sandboxed Lima VMs only mount the project directory. Instead of writing
// hook files into the project (which pollutes git), we inject the hook
// script and settings into the VM's ephemeral home directory at spawn time.

/**
 * Build the JSON content for the VM's ~/.claude/settings.json.
 * Uses $HOME/ouijit-hook as the command path (script lives in the VM's home dir).
 */
export function buildVmHookSettings(): string {
  return JSON.stringify(buildHookSettings('$HOME/ouijit-hook', '$HOME/ouijit-plan-hook'), null, 2);
}

/**
 * Build the TOML content for the VM's ~/.codex/config.toml. There is no `codex`
 * wrapper inside the sandbox, so the lifecycle hooks + turn-complete notifier
 * are wired via the config file instead. The CLI reference is deliberately
 * omitted — the ouijit CLI is not installed in the sandbox. $HOME stays
 * literal so the in-VM shell expands it.
 *
 * Written into the VM via a *quoted* heredoc (no expansion) so that `$HOME` in
 * hook commands reaches Codex unchanged and gets expanded by the agent's shell.
 */
export function buildVmCodexConfig(): string {
  const hookPath = '$HOME/ouijit-hook';
  const lines = [`notify = ["bash", "-c", "${codexHookCommand(hookPath, 'ready')}"]`];
  for (const [event, status] of CODEX_STATUS_HOOKS) {
    lines.push(`hooks.${event} = ${codexHookEventValue(hookPath, status)}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the `[hooks.state]` trust-state lines for the VM's ~/.codex/config.toml.
 * The key prefix is the absolute path of the config file, which we can only
 * resolve at write time inside the VM — so this is meant to be appended via an
 * *unquoted* heredoc so the VM's bash expands `$HOME` in the key.
 */
export function buildVmCodexTrustState(): string {
  const hookPath = '$HOME/ouijit-hook';
  const source = '$HOME/.codex/config.toml';
  const lines = CODEX_STATUS_HOOKS.map(([, status, eventSnake]) => {
    const cmd = codexHookCommand(hookPath, status);
    const stateKey = codexHookStateKey(source, eventSnake);
    const hash = codexHookTrustHash(eventSnake, cmd);
    return `hooks.state."${stateKey}".trusted_hash = "${hash}"`;
  });
  lines.push('');
  return lines.join('\n');
}

/** Pi extension for the sandbox VM. Identical to the host-side source. */
export function buildVmPiExtension(): string {
  return PI_EXTENSION;
}

/** opencode status plugin for the sandbox VM. Identical to the host-side source. */
export function buildVmOpencodePlugin(): string {
  return OPENCODE_PLUGIN;
}
