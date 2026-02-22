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
import log from './log';

const hookServerLog = log.scope('hookServer');

let server: http.Server | null = null;
let apiPort = 0;
let mainWindow: BrowserWindow | null = null;

/** Get the port the hook server is listening on. */
export function getApiPort(): number {
  return apiPort;
}

// ── Action handlers ──────────────────────────────────────────────────

type ActionHandler = (body: Record<string, unknown>) => void;

const VALID_STATUSES = new Set(['thinking', 'ready']);

const actionHandlers: Record<string, ActionHandler> = {
  status(body) {
    const { ptyId, status } = body;
    if (typeof ptyId !== 'string' || typeof status !== 'string') return;
    if (!VALID_STATUSES.has(status)) return;
    hookServerLog.info('status update', { ptyId, status });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude-hook-status', ptyId, status);
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
      // Only accept POST /hook
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404);
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
          if (typeof action === 'string') {
            const handler = actionHandlers[action];
            if (handler) {
              handler(body);
            }
          }
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

interface HookEntry { type: 'command'; command: string }
interface HookMatcher { matcher?: string; hooks: HookEntry[] }

/** Build hook settings for a given ouijit-hook command path. */
function buildHookSettings(hookCmd: string): { hooks: Record<string, HookMatcher[]> } {
  return {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: `${hookCmd} status status=thinking` }] },
      ],
      PostToolUse: [
        { hooks: [{ type: 'command', command: `${hookCmd} status status=thinking` }] },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: `${hookCmd} status status=ready` }] },
      ],
      Notification: [
        { matcher: 'permission_prompt|idle_prompt', hooks: [{ type: 'command', command: `${hookCmd} status status=ready` }] },
      ],
    },
  };
}

// ── Hook installer ───────────────────────────────────────────────────

// Safe pattern: alphanumeric, hyphens, dots, underscores
const SAFE_VALUE = '[a-zA-Z0-9._-]+';

export const HELPER_SCRIPT = [
  '#!/bin/bash',
  '# Ouijit API client for Claude Code hooks',
  '# Usage: ouijit-hook <action> [key=value ...]',
  '[ -z "$OUIJIT_API_URL" ] && exit 0',
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
  '  -d "{$json}" 2>/dev/null &',
  '',
].join('\n');

/** Bash wrapper that shadows `claude` and injects hook settings via --settings. */
export const CLAUDE_WRAPPER = [
  '#!/bin/bash',
  '# Ouijit claude wrapper — injects hook settings at invocation time.',
  '# Removes its own directory from PATH to find the real claude binary.',
  'WRAPPER_DIR="$(cd "$(dirname "$0")" && pwd)"',
  'PATH=":$PATH:"',
  'PATH="${PATH//:$WRAPPER_DIR:/:}"',
  'PATH="${PATH#:}"',
  'PATH="${PATH%:}"',
  'export PATH',
  '',
  '# If ouijit is not running, just exec the real claude without hooks',
  'if [ -z "$OUIJIT_API_URL" ]; then',
  '  exec claude "$@"',
  'fi',
  '',
  '# Inject ouijit hooks via --settings (merges with user settings at runtime)',
  `exec claude --settings '${JSON.stringify(buildHookSettings('$HOME/.config/Ouijit/bin/ouijit-hook'))}' "$@"`,
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

    // Write ouijit-hook helper script (curl client invoked by hooks)
    fs.writeFileSync(path.join(binDir, 'ouijit-hook'), HELPER_SCRIPT, { mode: 0o755 });

    // Write claude wrapper script (shadows `claude` to inject --settings)
    fs.writeFileSync(path.join(binDir, 'claude'), CLAUDE_WRAPPER, { mode: 0o755 });

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
            entry => !entry.hooks?.some(h => h.command?.includes('ouijit-hook')),
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
    try { fs.unlinkSync(path.join(configDir, 'hooks-version')); } catch { /* already gone */ }

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
  return JSON.stringify(buildHookSettings('$HOME/ouijit-hook'), null, 2);
}
