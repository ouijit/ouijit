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
import { BrowserWindow } from 'electron';
import { isPtyActive } from './ptyManager';
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

/** Clear the plan file path for a pty and notify the renderer. */
export function clearPlanPath(ptyId: string): boolean {
  if (!planPathMap.has(ptyId)) return false;
  planPathMap.delete(ptyId);
  hookServerLog.info('plan cleared', { ptyId });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('claude-plan-detected', ptyId, null);
  }
  return true;
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
      mainWindow.webContents.send('claude-hook-status', ptyId, status);
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

/** Path where shell integration scripts live. */
export function getShellIntegrationDir(): string {
  return path.join(os.homedir(), '.config', 'Ouijit', 'shell-integration');
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
ouijit task create "<name>"                   # → {success, task: {taskNumber, ...}}
ouijit task create "<name>" --prompt "<text>" # set description at creation
ouijit task start <number>                    # creates git worktree, sets in_progress
ouijit task create-and-start "<name>"         # create + start in one step
ouijit task set-status <number> <status>      # status: todo | in_progress | in_review | done
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
Hook types: start, continue, run, review, cleanup, editor

ouijit hook list                              # → {start?: {name, command}, ...}
ouijit hook get <type>
ouijit hook set <type> --name "<name>" --command "<cmd>"
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
# Check what tasks exist, then update yours:
ouijit task list
ouijit task set-status 5 in_review

# Create a task and immediately start working:
ouijit task create-and-start "Fix auth timeout" --prompt "Session expires too early"

# Tag and describe a task:
ouijit task set-description 3 "Refactor the auth middleware to use JWT refresh tokens"
ouijit tag add 3 refactor
ouijit tag add 3 auth

# Set up a project run hook:
ouijit hook set run --name "Dev server" --command "npm run dev"
`;

/** Bash wrapper that shadows `claude` and injects hook settings via --settings. */
export const CLAUDE_WRAPPER = [
  '#!/bin/bash',
  '# Ouijit claude wrapper — injects hook settings at invocation time.',
  '# Removes its own directory from PATH to find the real claude binary,',
  '# then re-exports it so ouijit CLI is available inside Claude Code.',
  'WRAPPER_DIR="$(cd "$(dirname "$0")" && pwd)"',
  'CLEAN_PATH=":$PATH:"',
  'CLEAN_PATH="${CLEAN_PATH//:$WRAPPER_DIR:/:}"',
  'CLEAN_PATH="${CLEAN_PATH#:}"',
  'CLEAN_PATH="${CLEAN_PATH%:}"',
  '',
  '# Resolve the real claude binary from the clean PATH',
  'REAL_CLAUDE="$(PATH="$CLEAN_PATH" command -v claude)"',
  'if [ -z "$REAL_CLAUDE" ]; then',
  '  echo "ouijit: claude not found on PATH" >&2',
  '  exit 1',
  'fi',
  '',
  '# Re-export PATH with wrapper dir so ouijit CLI works inside Claude Code',
  'export PATH="$WRAPPER_DIR:$CLEAN_PATH"',
  '',
  '# CLI reference file for Claude Code agents',
  'REFERENCE_FILE="$HOME/.config/Ouijit/ouijit-cli-reference.md"',
  '',
  '# If ouijit is not running, just exec the real claude with CLI awareness',
  'if [ -z "$OUIJIT_API_URL" ]; then',
  '  exec "$REAL_CLAUDE" --append-system-prompt-file "$REFERENCE_FILE" "$@"',
  'fi',
  '',
  '# Inject ouijit hooks via --settings (merges with user settings at runtime)',
  `exec "$REAL_CLAUDE" --settings '${JSON.stringify(buildHookSettings('$HOME/.config/Ouijit/bin/ouijit-hook', '$HOME/.config/Ouijit/bin/ouijit-plan-hook'))}' --append-system-prompt-file "$REFERENCE_FILE" "$@"`,
  '',
].join('\n');

// ── Shell integration scripts ────────────────────────────────────────
// These scripts ensure the wrapper dir stays first in PATH even after
// shell init files (.zshrc, .bashrc) prepend other directories.

/** zsh ZDOTDIR bootstrap — written to shell-integration/zsh/.zshenv */
export const ZSH_ZSHENV = [
  '# Ouijit zsh integration — ZDOTDIR bootstrap',
  '# Restores original ZDOTDIR, sources user .zshenv, loads PATH fix.',
  'ZDOTDIR="$OUIJIT_ZSH_ZDOTDIR"',
  '[ -z "$ZDOTDIR" ] && unset ZDOTDIR',
  '',
  '# Source user .zshenv',
  'if [ -f "${ZDOTDIR:-$HOME}/.zshenv" ]; then',
  '  . "${ZDOTDIR:-$HOME}/.zshenv"',
  'fi',
  '',
  '# For interactive shells, load PATH fix',
  'if [[ -o interactive ]]; then',
  '  . "$OUIJIT_SHELL_INTEGRATION_DIR/ouijit-zsh-integration.zsh"',
  'fi',
  '',
].join('\n');

/** zsh PATH fix — written to shell-integration/ouijit-zsh-integration.zsh */
export const ZSH_INTEGRATION = [
  '# Ouijit zsh integration — ensures wrapper dir stays first in PATH.',
  '_ouijit_fix_path() {',
  '  PATH=":$PATH:"',
  '  PATH="${PATH//:$OUIJIT_WRAPPER_DIR:/:}"',
  '  PATH="${PATH#:}"',
  '  PATH="${PATH%:}"',
  '  PATH="$OUIJIT_WRAPPER_DIR:$PATH"',
  '  export PATH',
  '  # Self-remove after first invocation',
  '  precmd_functions=(${precmd_functions:#_ouijit_fix_path})',
  '  preexec_functions=(${preexec_functions:#_ouijit_fix_path})',
  '}',
  'precmd_functions+=(_ouijit_fix_path)',
  'preexec_functions+=(_ouijit_fix_path)',
  '',
].join('\n');

/** bash rcfile replacement — written to shell-integration/ouijit-bash-integration.bash */
export const BASH_INTEGRATION = [
  '# Ouijit bash integration — sources .bashrc then fixes PATH.',
  'if [ -f "$HOME/.bashrc" ]; then',
  '  . "$HOME/.bashrc"',
  'fi',
  '',
  '# Fix PATH: remove wrapper dir, re-prepend it',
  'PATH=":$PATH:"',
  'PATH="${PATH//:$OUIJIT_WRAPPER_DIR:/:}"',
  'PATH="${PATH#:}"',
  'PATH="${PATH%:}"',
  'PATH="$OUIJIT_WRAPPER_DIR:$PATH"',
  'export PATH',
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

    // Write shell integration scripts (re-fix PATH after shell init)
    const integrationDir = getShellIntegrationDir();
    const zshDir = path.join(integrationDir, 'zsh');
    fs.mkdirSync(zshDir, { recursive: true });
    fs.writeFileSync(path.join(zshDir, '.zshenv'), ZSH_ZSHENV, { mode: 0o644 });
    fs.writeFileSync(path.join(integrationDir, 'ouijit-zsh-integration.zsh'), ZSH_INTEGRATION, { mode: 0o644 });
    fs.writeFileSync(path.join(integrationDir, 'ouijit-bash-integration.bash'), BASH_INTEGRATION, { mode: 0o644 });
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
