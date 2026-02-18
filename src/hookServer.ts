/**
 * HTTP API server for Claude Code hook communication + hook installer.
 *
 * Hooks fire lifecycle events (Stop, UserPromptSubmit, Notification) which
 * hit this server via curl. The server forwards status updates to the
 * renderer so terminal cards show the correct busy/idle indicator.
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BrowserWindow } from 'electron';

let server: http.Server | null = null;
let apiPort = 0;
let apiToken = '';
let mainWindow: BrowserWindow | null = null;

/** Get the port the hook server is listening on. */
export function getApiPort(): number {
  return apiPort;
}

/** Get the auth token for hook requests. */
export function getApiToken(): string {
  return apiToken;
}

// ── Action handlers ──────────────────────────────────────────────────

type ActionHandler = (body: Record<string, string>) => void;

const actionHandlers: Record<string, ActionHandler> = {
  status(body) {
    const { ptyId, status } = body;
    if (!ptyId || !status) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude-hook-status', ptyId, status);
    }
  },
};

// ── Server lifecycle ─────────────────────────────────────────────────

/** Start the hook HTTP server. Call once at app init. */
export function startHookServer(window: BrowserWindow): void {
  if (server) return;
  mainWindow = window;
  apiToken = crypto.randomBytes(16).toString('hex');

  server = http.createServer((req, res) => {
    // Only accept POST /hook
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404);
      res.end();
      return;
    }

    // Validate auth token
    if (req.headers.authorization !== apiToken) {
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
        const body = JSON.parse(rawBody) as Record<string, string>;
        const handler = actionHandlers[body.action];
        if (handler) {
          handler(body);
        }
        res.writeHead(200);
        res.end();
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const addr = server!.address();
    if (addr && typeof addr === 'object') {
      apiPort = addr.port;
    }
  });
}

/** Stop the hook server. Call on app quit. */
export function stopHookServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}

// ── Hook installer ───────────────────────────────────────────────────

const HELPER_SCRIPT = `#!/bin/bash
# Ouijit API client for Claude Code hooks
# Usage: ouijit-hook <action> [key=value ...]
# Always includes ptyId from OUIJIT_PTY_ID env var.
[ -z "$OUIJIT_API_URL" ] && exit 0
action="$1"; shift
json="\\"ptyId\\":\\"$OUIJIT_PTY_ID\\",\\"action\\":\\"$action\\""
for arg in "$@"; do
  key="\${arg%%=*}"; val="\${arg#*=}"
  json="$json,\\"$key\\":\\"$val\\""
done
curl -sf -o /dev/null -X POST "$OUIJIT_API_URL/hook" \\
  -H "Authorization: $OUIJIT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{$json}" 2>/dev/null &
`;

interface ClaudeHookEntry {
  type: 'command';
  command: string;
}

interface ClaudeHookMatcher {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookMatcher[]>;
  [key: string]: unknown;
}

const OUIJIT_HOOKS: Record<string, ClaudeHookMatcher> = {
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: '~/.config/Ouijit/bin/ouijit-hook status status=thinking' }],
  },
  Stop: {
    hooks: [{ type: 'command', command: '~/.config/Ouijit/bin/ouijit-hook status status=idle' }],
  },
  Notification: {
    matcher: 'permission_prompt|idle_prompt',
    hooks: [{ type: 'command', command: '~/.config/Ouijit/bin/ouijit-hook status status=idle' }],
  },
};

function isOuijitHook(entry: ClaudeHookMatcher): boolean {
  return entry.hooks?.some(h => h.command?.includes('ouijit-hook')) ?? false;
}

/**
 * Install the ouijit-hook helper script and register hooks in
 * ~/.claude/settings.json. Merges with existing user hooks.
 */
export function installHooks(): void {
  try {
    // 1. Write helper script
    const binDir = path.join(os.homedir(), '.config', 'Ouijit', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const scriptPath = path.join(binDir, 'ouijit-hook');
    fs.writeFileSync(scriptPath, HELPER_SCRIPT, { mode: 0o755 });

    // 2. Merge hooks into ~/.claude/settings.json
    const claudeDir = path.join(os.homedir(), '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
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

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[HookServer] Failed to install hooks:', err instanceof Error ? err.message : err);
  }
}
