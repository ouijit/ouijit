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

let server: http.Server | null = null;
let apiPort = 0;
let mainWindow: BrowserWindow | null = null;

/** Get the port the hook server is listening on. */
export function getApiPort(): number {
  return apiPort;
}

// ── Action handlers ──────────────────────────────────────────────────

type ActionHandler = (body: Record<string, unknown>) => void;

const VALID_STATUSES = new Set(['thinking', 'idle']);

const actionHandlers: Record<string, ActionHandler> = {
  status(body) {
    const { ptyId, status } = body;
    if (typeof ptyId !== 'string' || typeof status !== 'string') return;
    if (!VALID_STATUSES.has(status)) return;
    console.log(`[hook] ${ptyId} → ${status}`);
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

// ── Hook installer ───────────────────────────────────────────────────

// Bump this when HELPER_SCRIPT or OUIJIT_HOOKS change.
export const HOOK_VERSION = 4;

// Safe pattern: alphanumeric, hyphens, dots, underscores
const SAFE_VALUE = '[a-zA-Z0-9._-]+';

const HELPER_SCRIPT = [
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
  'if [ -n "$OUIJIT_DEBUG" ]; then',
  '  status=$(curl -sf -o /dev/null -w \'%{http_code}\' -X POST "$OUIJIT_API_URL/hook" \\',
  '    -H "Content-Type: application/json" \\',
  '    -d "{$json}" 2>/dev/null)',
  '  [ "$status" != "200" ] && \\',
  '    echo "[ouijit-hook] $action -> HTTP $status" >> "${TMPDIR:-/tmp}/ouijit-hook.log"',
  'else',
  '  curl -sf -o /dev/null -X POST "$OUIJIT_API_URL/hook" \\',
  '    -H "Content-Type: application/json" \\',
  '    -d "{$json}" 2>/dev/null &',
  'fi',
  '',
].join('\n');

export interface ClaudeHookEntry {
  type: 'command';
  command: string;
}

export interface ClaudeHookMatcher {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}

export interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookMatcher[]>;
  [key: string]: unknown;
}

const OUIJIT_HOOKS: Record<string, ClaudeHookMatcher> = {
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=thinking' }],
  },
  Stop: {
    hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=idle' }],
  },
  Notification: {
    matcher: 'permission_prompt|idle_prompt',
    hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=idle' }],
  },
};

export function isOuijitHook(entry: ClaudeHookMatcher): boolean {
  return entry.hooks?.some(h => h.command?.includes('ouijit-hook')) ?? false;
}

/** Path to the file that stores the installed hook version. */
function versionFilePath(): string {
  return path.join(os.homedir(), '.config', 'Ouijit', 'hooks-version');
}

/**
 * Install the ouijit-hook helper script and register hooks in
 * ~/.claude/settings.json. Skips if Claude Code isn't installed
 * (~/.claude/ doesn't exist) or hooks are already up-to-date.
 */
export function installHooks(): void {
  try {
    // Skip entirely if Claude Code isn't installed
    const claudeDir = path.join(os.homedir(), '.claude');
    if (!fs.existsSync(claudeDir)) return;

    // Check version marker — skip if already current
    const versionPath = versionFilePath();
    try {
      const installed = fs.readFileSync(versionPath, 'utf-8').trim();
      if (installed === String(HOOK_VERSION)) return;
    } catch {
      // File doesn't exist — proceed with install
    }

    // 1. Write helper script
    const binDir = path.join(os.homedir(), '.config', 'Ouijit', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const scriptPath = path.join(binDir, 'ouijit-hook');
    fs.writeFileSync(scriptPath, HELPER_SCRIPT, { mode: 0o755 });

    // 2. Merge hooks into ~/.claude/settings.json
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settings: ClaudeSettings = {};
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(raw) as ClaudeSettings;
    } catch {
      // File doesn't exist or is invalid — start fresh
    }

    if (!settings.hooks) {
      settings.hooks = {};
    }

    for (const [event, ouijitEntry] of Object.entries(OUIJIT_HOOKS)) {
      const existing = settings.hooks[event] || [];

      // Remove any existing Ouijit hook entries for this event
      const filtered = existing.filter(e => !isOuijitHook(e));

      // Append our entry
      filtered.push(ouijitEntry);
      settings.hooks[event] = filtered;
    }

    // Write atomically via temp file + rename
    const tmpPath = settingsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, settingsPath);

    // 3. Write version marker
    fs.writeFileSync(versionPath, String(HOOK_VERSION) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[HookServer] Failed to install hooks:', err instanceof Error ? err.message : err);
  }
}

// ── Project-level hook installer ─────────────────────────────────────
// Sandboxed Lima VMs only mount the project directory, so the global
// ~/.claude/settings.json and ~/.config/Ouijit/bin/ouijit-hook are NOT
// accessible inside the VM. We install the hook script and settings at
// the project level so Claude Code inside the VM can find them.

const PROJECT_HOOK_CMD_PREFIX = '"$CLAUDE_PROJECT_DIR/.claude/hooks/ouijit-hook"';

const PROJECT_HOOKS: Record<string, ClaudeHookMatcher> = {
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: `${PROJECT_HOOK_CMD_PREFIX} status status=thinking` }],
  },
  Stop: {
    hooks: [{ type: 'command', command: `${PROJECT_HOOK_CMD_PREFIX} status status=idle` }],
  },
  Notification: {
    matcher: 'permission_prompt|idle_prompt',
    hooks: [{ type: 'command', command: `${PROJECT_HOOK_CMD_PREFIX} status status=idle` }],
  },
};

/** Version marker path scoped to a project. */
function projectVersionFilePath(projectPath: string): string {
  return path.join(projectPath, '.claude', 'hooks', '.ouijit-hooks-version');
}

/**
 * Install hooks at the project level so they work inside Lima VMs.
 * Writes the helper script to <project>/.claude/hooks/ouijit-hook and
 * merges hook entries into <project>/.claude/settings.local.json.
 */
export function installProjectHooks(projectPath: string): void {
  try {
    const claudeDir = path.join(projectPath, '.claude');
    const hooksDir = path.join(claudeDir, 'hooks');

    // Check version marker — skip if already current
    const versionPath = projectVersionFilePath(projectPath);
    try {
      const installed = fs.readFileSync(versionPath, 'utf-8').trim();
      if (installed === String(HOOK_VERSION)) return;
    } catch {
      // File doesn't exist — proceed with install
    }

    // 1. Write helper script into project
    fs.mkdirSync(hooksDir, { recursive: true });
    const scriptPath = path.join(hooksDir, 'ouijit-hook');
    fs.writeFileSync(scriptPath, HELPER_SCRIPT, { mode: 0o755 });

    // 2. Merge hooks into .claude/settings.local.json (not committed to git)
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    let settings: ClaudeSettings = {};
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(raw) as ClaudeSettings;
    } catch {
      // File doesn't exist or is invalid — start fresh
    }

    if (!settings.hooks) {
      settings.hooks = {};
    }

    for (const [event, ouijitEntry] of Object.entries(PROJECT_HOOKS)) {
      const existing = settings.hooks[event] || [];
      const filtered = existing.filter(e => !isOuijitHook(e));
      filtered.push(ouijitEntry);
      settings.hooks[event] = filtered;
    }

    const tmpPath = settingsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, settingsPath);

    // 3. Write version marker
    fs.writeFileSync(versionPath, String(HOOK_VERSION) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[HookServer] Failed to install project hooks:', err instanceof Error ? err.message : err);
  }
}

/**
 * Remove Ouijit hooks from ~/.claude/settings.json and clean up the helper script.
 */
export function uninstallHooks(): void {
  try {
    // 1. Remove hooks from settings.json
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw) as ClaudeSettings;
      if (settings.hooks) {
        let changed = false;
        for (const event of Object.keys(settings.hooks)) {
          const filtered = settings.hooks[event].filter(e => !isOuijitHook(e));
          if (filtered.length !== settings.hooks[event].length) {
            changed = true;
            if (filtered.length === 0) {
              delete settings.hooks[event];
            } else {
              settings.hooks[event] = filtered;
            }
          }
        }
        // Remove empty hooks object
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
        if (changed) {
          const tmpPath = settingsPath + '.tmp';
          fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
          fs.renameSync(tmpPath, settingsPath);
        }
      }
    } catch {
      // Settings file doesn't exist or is invalid — nothing to clean up
    }

    // 2. Remove helper script
    const scriptPath = path.join(os.homedir(), '.config', 'Ouijit', 'bin', 'ouijit-hook');
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // Already gone
    }

    // 3. Remove version marker
    try {
      fs.unlinkSync(versionFilePath());
    } catch {
      // Already gone
    }
  } catch (err) {
    console.warn('[HookServer] Failed to uninstall hooks:', err instanceof Error ? err.message : err);
  }
}
