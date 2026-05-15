import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { BrowserWindow } from 'electron';

const hasZsh = (() => {
  try {
    execFileSync('which', ['zsh'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// Mutable homedir for install tests — must be declared before vi.mock
let _testHomedir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: () => _testHomedir || actual.homedir(),
  };
});

vi.mock('../ptyManager', () => ({
  isPtyActive: () => true,
}));

import {
  startHookServer,
  stopHookServer,
  getApiPort,
  installWrapper,
  migrateFromSettingsHooks,
  buildVmHookSettings,
  buildVmCodexConfig,
  buildVmCodexTrustState,
  buildVmPiExtension,
  CLAUDE_WRAPPER,
  CODEX_WRAPPER,
  PI_WRAPPER,
  PI_EXTENSION,
} from '../hookServer';
import { issueToken, revokeAllTokens } from '../apiAuth';

// ── Test helpers ─────────────────────────────────────────────────────

interface HookSettings {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
  [key: string]: unknown;
}

const mockSend = vi.fn();
function createMockWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: mockSend },
  } as unknown as BrowserWindow;
}

/**
 * Auth-aware POST helper. Infers the ptyId from the body and issues a
 * matching token, so the scope check (ptyId === auth.ptyId) passes.
 */
function post(port: number, body: unknown, overrideToken?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const bodyObj = body as { ptyId?: string };
    const token =
      overrideToken ??
      (typeof bodyObj.ptyId === 'string' ? issueToken(bodyObj.ptyId, 'host') : issueToken('pty-test', 'host'));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Temp directory for install tests
let tmpHome: string;

beforeEach(() => {
  mockSend.mockClear();
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hookserver-test-'));
});

afterEach(async () => {
  await stopHookServer();
  revokeAllTokens();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// ── Server lifecycle ─────────────────────────────────────────────────

describe('startHookServer', () => {
  test('resolves with port > 0 once listening', async () => {
    const win = createMockWindow();
    await startHookServer(win);
    expect(getApiPort()).toBeGreaterThan(0);
  });

  test('calling twice is a no-op', async () => {
    const win = createMockWindow();
    await startHookServer(win);
    const port1 = getApiPort();
    await startHookServer(win);
    expect(getApiPort()).toBe(port1);
  });
});

describe('stopHookServer', () => {
  test('stops listening and resets state', async () => {
    const win = createMockWindow();
    await startHookServer(win);
    const port = getApiPort();
    await stopHookServer();

    // Server is gone — connection should fail
    await expect(post(port, {})).rejects.toThrow();
  });

  test('calling when not started is a no-op', async () => {
    await stopHookServer(); // Should not throw
  });
});

// ── HTTP request handling ────────────────────────────────────────────

describe('HTTP server', () => {
  let port: number;

  beforeEach(async () => {
    await startHookServer(createMockWindow());
    port = getApiPort();
  });

  test('returns 404 for non-POST or wrong path', async () => {
    // GET request
    const res = await new Promise<number>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/hook`, (res) => resolve(res.statusCode!)).on('error', reject);
    });
    expect(res).toBe(404);

    // POST to wrong path
    const res2 = await new Promise<number>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/other', method: 'POST' }, (res) =>
        resolve(res.statusCode!),
      );
      req.on('error', reject);
      req.end();
    });
    expect(res2).toBe(404);
  });

  test('returns 200 for valid request', async () => {
    const res = await post(port, { action: 'status', ptyId: 'pty-123', status: 'thinking' });
    expect(res.status).toBe(200);
  });

  test('returns 400 for invalid JSON', async () => {
    const token = issueToken('pty-json-test', 'host');
    const res = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hook',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        },
        (res) => resolve(res.statusCode!),
      );
      req.on('error', reject);
      req.write('not-json{{{');
      req.end();
    });
    expect(res).toBe(400);
  });

  test('returns 401 without auth token', async () => {
    const res = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/hook',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => resolve(res.statusCode!),
      );
      req.on('error', reject);
      req.write(JSON.stringify({ action: 'status', ptyId: 'pty-123', status: 'thinking' }));
      req.end();
    });
    expect(res).toBe(401);
  });

  test('rejects hook calls that spoof a different ptyId with 403', async () => {
    // Token issued for pty-a, but the body claims pty-b. Must be rejected
    // so a compromised guest can't drive a sibling terminal's status.
    const tokenA = issueToken('pty-a', 'sandbox');
    const res = await post(port, { action: 'status', ptyId: 'pty-b', status: 'thinking' }, tokenA);
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns 200 for unknown action (no-op)', async () => {
    const res = await post(port, { action: 'unknown-action' });
    expect(res.status).toBe(200);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ── Status action handler ────────────────────────────────────────────

describe('status action', () => {
  let port: number;

  beforeEach(async () => {
    await startHookServer(createMockWindow());
    port = getApiPort();
  });

  test('sends IPC for valid thinking status', async () => {
    await post(port, { action: 'status', ptyId: 'pty-123', status: 'thinking' });
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-123', 'thinking');
  });

  test('sends IPC for valid ready status', async () => {
    await post(port, { action: 'status', ptyId: 'pty-789', status: 'ready' });
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-789', 'ready');
  });

  test('rejects invalid status values', async () => {
    await post(port, { action: 'status', ptyId: 'pty-123', status: 'running' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('rejects missing ptyId', async () => {
    await post(port, { action: 'status', status: 'thinking' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('rejects non-string ptyId or status', async () => {
    await post(port, { action: 'status', ptyId: 123, status: 'thinking' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('does not send when window is destroyed', async () => {
    await stopHookServer();
    await startHookServer(createMockWindow(true));
    port = getApiPort();

    await post(port, { action: 'status', ptyId: 'pty-123', status: 'thinking' });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ── installWrapper ───────────────────────────────────────────────────

describe('installWrapper', () => {
  beforeEach(() => {
    _testHomedir = tmpHome;
  });

  afterEach(() => {
    _testHomedir = '';
  });

  test('creates helper script and claude wrapper on first install', () => {
    installWrapper();

    // Helper script exists with expected content
    const helperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'ouijit-hook');
    const helper = fs.readFileSync(helperPath, 'utf-8');
    expect(helper).toContain('#!/bin/bash');
    expect(helper).toContain('OUIJIT_API_URL');
    expect(helper).toContain('OUIJIT_PTY_ID');
    expect(helper).toContain('[a-zA-Z0-9._-]+');

    // Claude wrapper exists with expected content
    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'claude');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    expect(wrapper).toContain('#!/bin/bash');
    expect(wrapper).toContain('WRAPPER_DIR');
    expect(wrapper).toContain('exec "$REAL_CLAUDE" --settings');
    expect(wrapper).toContain('ouijit-hook');
  });

  test('wrapper falls through when OUIJIT_API_URL is unset', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'claude');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    // Contains the fallthrough: exec real claude without --settings but with reference file
    expect(wrapper).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(wrapper).toContain('exec "$REAL_CLAUDE" --append-system-prompt-file "$REFERENCE_FILE" "$@"');
  });

  test('wrapper injects all 4 hook events via --settings', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'claude');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');

    // Extract the JSON from the --settings argument
    const match = wrapper.match(/--settings '([^']+)'/);
    expect(match).not.toBeNull();
    const settings = JSON.parse(match![1]) as HookSettings;

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks!.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks!.PostToolUse).toHaveLength(3); // status + plan detection + ExitPlanMode
    expect(settings.hooks!.PostToolUse![1].matcher).toBe('Write|Edit');
    expect(settings.hooks!.PostToolUse![2].matcher).toBe('ExitPlanMode');
    expect(settings.hooks!.Stop).toHaveLength(1);
    expect(settings.hooks!.Notification).toHaveLength(1);
    expect(settings.hooks!.Notification![0].matcher).toBe('permission_prompt|idle_prompt');
  });

  test('creates codex wrapper on first install', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'codex');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    expect(wrapper).toContain('#!/bin/bash');
    expect(wrapper).toContain('REAL_CODEX=');
    expect(wrapper).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
    // Injects the CLI reference + lifecycle hooks + per-hook pre-trust + notify via -c overrides
    expect(wrapper).toContain('-c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)"');
    expect(wrapper).toContain("-c 'hooks.UserPromptSubmit=");
    expect(wrapper).toContain("-c 'hooks.PostToolUse=");
    expect(wrapper).toContain("-c 'hooks.Stop=");
    expect(wrapper).toContain("-c 'hooks.PermissionRequest=");
    expect(wrapper).toContain('-c \'hooks.state."/<session-flags>/config.toml:user_prompt_submit:0:0".trusted_hash=');
    expect(wrapper).toContain('-c \'hooks.state."/<session-flags>/config.toml:permission_request:0:0".trusted_hash=');
    expect(wrapper).toContain("-c 'notify=");
    // No-API fallthrough still passes developer_instructions
    expect(wrapper).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(wrapper).toContain(
      'exec "$REAL_CODEX" -c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"',
    );
  });

  test('creates pi wrapper and extension on first install', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'pi');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    expect(wrapper).toContain('#!/bin/bash');
    expect(wrapper).toContain('REAL_PI=');
    expect(wrapper).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
    expect(wrapper).toContain('--append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)"');
    expect(wrapper).toContain('--extension "$EXTENSION_FILE"');
    expect(wrapper).toContain('OUIJIT_HOOK_BIN="$HOOK_BIN" exec "$REAL_PI"');
    expect(wrapper).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(wrapper).toContain('exec "$REAL_PI" --append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"');

    const extPath = path.join(tmpHome, '.config', 'Ouijit', 'pi', 'ouijit-extension.ts');
    expect(fs.existsSync(extPath)).toBe(true);
    const ext = fs.readFileSync(extPath, 'utf-8');
    expect(ext).toContain('export default');
    expect(ext).toContain("pi.on('turn_start'");
    expect(ext).toContain("pi.on('turn_end'");
    expect(ext).toContain('OUIJIT_HOOK_BIN');
  });

  test('creates CLI reference file with command documentation', () => {
    installWrapper();

    const refPath = path.join(tmpHome, '.config', 'Ouijit', 'ouijit-cli-reference.md');
    expect(fs.existsSync(refPath)).toBe(true);
    const content = fs.readFileSync(refPath, 'utf-8');
    // Contains all command groups
    expect(content).toContain('ouijit task list');
    expect(content).toContain('ouijit tag');
    expect(content).toContain('ouijit hook');
    expect(content).toContain('ouijit script');
    expect(content).toContain('ouijit plan');
    expect(content).toContain('ouijit project list');
    // Contains env var documentation
    expect(content).toContain('OUIJIT_API_URL');
    expect(content).toContain('OUIJIT_PTY_ID');
  });

  test('does not require ~/.claude to exist', () => {
    // No .claude dir — wrapper should still install (unlike the old installHooks)
    expect(fs.existsSync(path.join(tmpHome, '.claude'))).toBe(false);

    installWrapper();

    // Wrapper and helper should exist
    expect(fs.existsSync(path.join(tmpHome, '.config', 'Ouijit', 'bin', 'claude'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.config', 'Ouijit', 'bin', 'ouijit-hook'))).toBe(true);
  });

  test('does not touch ~/.claude/settings.json', () => {
    // Create .claude dir to simulate Claude Code being installed
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });

    installWrapper();

    // settings.json should NOT be created
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'settings.json'))).toBe(false);
  });

  test('is idempotent', () => {
    installWrapper();
    installWrapper(); // Should not throw, just overwrites
    expect(fs.existsSync(path.join(tmpHome, '.config', 'Ouijit', 'bin', 'claude'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.config', 'Ouijit', 'bin', 'ouijit-hook'))).toBe(true);
  });
});

// ── CLAUDE_WRAPPER constant ──────────────────────────────────────────

describe('CLAUDE_WRAPPER', () => {
  test('resolves real claude and re-exports wrapper dir on PATH', () => {
    expect(CLAUDE_WRAPPER).toContain('WRAPPER_DIR=');
    expect(CLAUDE_WRAPPER).toContain('REAL_CLAUDE=');
    expect(CLAUDE_WRAPPER).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
  });

  test('contains valid embedded JSON', () => {
    const match = CLAUDE_WRAPPER.match(/--settings '([^']+)'/);
    expect(match).not.toBeNull();
    expect(() => JSON.parse(match![1])).not.toThrow();
  });

  test('PATH self-removal strips the wrapper dir (single occurrence)', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    // Extract just the PATH manipulation lines from the wrapper
    const result = await exec('bash', [
      '-c',
      [
        'WRAPPER_DIR="/home/user/.config/Ouijit/bin"',
        'PATH="/usr/bin:/home/user/.config/Ouijit/bin:/usr/local/bin"',
        'PATH=":$PATH:"',
        'PATH="${PATH//:$WRAPPER_DIR:/:}"',
        'PATH="${PATH#:}"',
        'PATH="${PATH%:}"',
        'echo "$PATH"',
      ].join('\n'),
    ]);

    expect(result.stdout.trim()).toBe('/usr/bin:/usr/local/bin');
  });

  test('PATH self-removal strips the wrapper dir (duplicate occurrences)', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    const result = await exec('bash', [
      '-c',
      [
        'WRAPPER_DIR="/home/user/.config/Ouijit/bin"',
        'PATH="/home/user/.config/Ouijit/bin:/usr/bin:/home/user/.config/Ouijit/bin:/usr/local/bin"',
        'PATH=":$PATH:"',
        'PATH="${PATH//:$WRAPPER_DIR:/:}"',
        'PATH="${PATH#:}"',
        'PATH="${PATH%:}"',
        'echo "$PATH"',
      ].join('\n'),
    ]);

    expect(result.stdout.trim()).toBe('/usr/bin:/usr/local/bin');
  });
});

// ── CODEX_WRAPPER constant ───────────────────────────────────────────

describe('CODEX_WRAPPER', () => {
  test('resolves real codex and re-exports wrapper dir on PATH', () => {
    expect(CODEX_WRAPPER).toContain('WRAPPER_DIR=');
    expect(CODEX_WRAPPER).toContain('REAL_CODEX=');
    expect(CODEX_WRAPPER).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
  });

  test('the notify override is a valid TOML/JSON array pointing at ouijit-hook', () => {
    const notifyMatch = CODEX_WRAPPER.match(/-c 'notify=(.+?)' \\/);
    expect(notifyMatch).not.toBeNull();
    const notify = JSON.parse(notifyMatch![1]) as string[];
    expect(notify[0]).toBe('bash');
    expect(notify).toContain('-c');
    expect(notify[2]).toBe('$HOME/.config/Ouijit/bin/ouijit-hook status status=ready');
  });

  test('injects the four status hooks as TOML arrays of inline tables (must NOT be JSON)', () => {
    // Each hooks.<Event> override is a TOML array. Codex parses -c values as
    // TOML; a JSON object would fail parse and degrade to a string, failing
    // typed deserialization. Asserting TOML inline-table syntax (`{k=v}`).
    const expected: Array<[string, 'thinking' | 'ready']> = [
      ['UserPromptSubmit', 'thinking'],
      ['PostToolUse', 'thinking'],
      ['Stop', 'ready'],
      ['PermissionRequest', 'ready'],
    ];
    for (const [event, status] of expected) {
      const re = new RegExp(
        `-c 'hooks\\.${event}=(\\[\\{hooks=\\[\\{type="command",command="[^"]+"\\}\\]\\}\\])' \\\\`,
      );
      const match = CODEX_WRAPPER.match(re);
      expect(match, `hooks.${event} override should be a TOML array of inline tables`).not.toBeNull();
      // Pull the command out and check the status mapping
      const cmdMatch = match![1].match(/command="([^"]+)"/);
      expect(cmdMatch![1]).toBe(`$HOME/.config/Ouijit/bin/ouijit-hook status status=${status}`);
      // Must be TOML, not JSON: no `"key":value` syntax
      expect(match![1]).not.toMatch(/"[A-Za-z_]+":/);
      // Codex skips async hooks today ("async hooks are not supported yet")
      expect(match![1]).not.toContain('async');
    }
  });

  test('falls through with just developer_instructions when OUIJIT_API_URL is unset', () => {
    expect(CODEX_WRAPPER).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(CODEX_WRAPPER).toContain(
      'exec "$REAL_CODEX" -c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"',
    );
  });

  test('pre-trusts each hook with the sha256 codex expects (locks the hash recipe)', () => {
    // These hashes mirror codex-rs/hooks/src/engine/discovery.rs:command_hook_hash —
    // sha256(canonical_json({event_name, hooks:[{type:"command",command,timeout:600,async:false}]})).
    // If any of them ever fail, either Codex's normalization changed or our recipe drifted;
    // a mismatch is graceful (Codex falls back to the /hooks review prompt) but we still
    // want a tripwire so we know to recompute.
    const expected: Record<string, string> = {
      'user_prompt_submit:0:0': 'sha256:f5cd19bf6ce12a88c683852526d77e2553778f51f15d92b0d7f18c1773161245',
      'post_tool_use:0:0': 'sha256:bba7cb97708e558b3d7746468ec196312d9c1a6cb685467177da4e99cca85115',
      'stop:0:0': 'sha256:bd8907212bcda4a71b2e580355c07c837a9f34ac96d01a037526921bdf435ffd',
      'permission_request:0:0': 'sha256:cb24d6656dd4fef6523820ae479cec67acfeae414590e837a926a7aa0daae1e5',
    };
    for (const [keySuffix, hash] of Object.entries(expected)) {
      const re = new RegExp(
        `-c 'hooks\\.state\\."/<session-flags>/config\\.toml:${keySuffix.replace(/:/g, '\\:')}"\\.trusted_hash="${hash}"'`,
      );
      expect(CODEX_WRAPPER, `pre-trust hash for ${keySuffix}`).toMatch(re);
    }
  });
});

// ── ouijit-hook → hook server integration ────────────────────────────

describe('ouijit-hook script → hook server integration', () => {
  let port: number;
  let scriptPath: string;

  beforeEach(async () => {
    _testHomedir = tmpHome;
    await startHookServer(createMockWindow());
    port = getApiPort();

    // Install wrapper to get the helper script on disk
    installWrapper();
    scriptPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'ouijit-hook');
  });

  afterEach(() => {
    _testHomedir = '';
  });

  /** Poll until mockSend is called or timeout. */
  async function waitForIpc(timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (mockSend.mock.calls.length > 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function runHookScript(action: string, args: string[], env: Record<string, string>): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    await exec('bash', [scriptPath, action, ...args], { env });
  }

  test('thinking status reaches hook server and triggers IPC', async () => {
    await runHookScript('status', ['status=thinking'], {
      OUIJIT_API_URL: `http://127.0.0.1:${port}`,
      OUIJIT_PTY_ID: 'pty-integration-1',
      OUIJIT_API_TOKEN: issueToken('pty-integration-1', 'host'),
      PATH: process.env['PATH'] || '',
    });

    await waitForIpc();
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-integration-1', 'thinking');
  });

  test('ready status reaches hook server and triggers IPC', async () => {
    await runHookScript('status', ['status=ready'], {
      OUIJIT_API_URL: `http://127.0.0.1:${port}`,
      OUIJIT_PTY_ID: 'pty-integration-2',
      OUIJIT_API_TOKEN: issueToken('pty-integration-2', 'host'),
      PATH: process.env['PATH'] || '',
    });

    await waitForIpc();
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-integration-2', 'ready');
  });

  test('script exits silently when OUIJIT_API_URL is unset', async () => {
    await runHookScript('status', ['status=thinking'], {
      OUIJIT_PTY_ID: 'pty-integration-3',
      OUIJIT_API_TOKEN: issueToken('pty-integration-3', 'host'),
      PATH: process.env['PATH'] || '',
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('script exits silently when OUIJIT_API_TOKEN is unset', async () => {
    await runHookScript('status', ['status=thinking'], {
      OUIJIT_API_URL: `http://127.0.0.1:${port}`,
      OUIJIT_PTY_ID: 'pty-integration-notoken',
      PATH: process.env['PATH'] || '',
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('script exits silently for invalid ptyId', async () => {
    await runHookScript('status', ['status=thinking'], {
      OUIJIT_API_URL: `http://127.0.0.1:${port}`,
      OUIJIT_PTY_ID: 'pty with spaces',
      OUIJIT_API_TOKEN: 'some-token',
      PATH: process.env['PATH'] || '',
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ── wrapper → ouijit-hook → hook server (end-to-end) ─────────────────

describe('wrapper → ouijit-hook → hook server (end-to-end)', () => {
  let port: number;
  let binDir: string;

  beforeEach(async () => {
    _testHomedir = tmpHome;
    await startHookServer(createMockWindow());
    port = getApiPort();
    installWrapper();
    binDir = path.join(tmpHome, '.config', 'Ouijit', 'bin');
  });

  afterEach(() => {
    _testHomedir = '';
  });

  /** Poll until mockSend is called or timeout. */
  async function waitForIpc(timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (mockSend.mock.calls.length > 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Create a mock claude that handles --settings by extracting and running hook commands. */
  function writeMockClaude(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'claude'),
      [
        '#!/bin/bash',
        '# Mock claude: find --settings, extract hook command, run it',
        'while [ $# -gt 0 ]; do',
        '  if [ "$1" = "--settings" ]; then',
        '    shift',
        '    CMD=$(node -e "const s=JSON.parse(process.argv[1]); console.log(s.hooks.UserPromptSubmit[0].hooks[0].command)" "$1")',
        '    eval "$CMD"',
        '    sleep 0.2',
        '    exit 0',
        '  fi',
        '  shift',
        'done',
        'echo "mock claude: --settings not received" >&2',
        'exit 1',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
  }

  test('wrapper passes --settings to claude, hook command triggers IPC', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    const mockBinDir = path.join(tmpHome, 'mock-bin');
    writeMockClaude(mockBinDir);

    // PATH: wrapper first (intercepted), then mock-bin (found after wrapper strips itself),
    // then system PATH (for bash, curl, node).
    await exec('/bin/bash', ['-c', 'claude'], {
      env: {
        PATH: `${binDir}:${mockBinDir}:${process.env['PATH'] || ''}`,
        HOME: tmpHome,
        OUIJIT_API_URL: `http://127.0.0.1:${port}`,
        OUIJIT_PTY_ID: 'pty-e2e-1',
        OUIJIT_API_TOKEN: issueToken('pty-e2e-1', 'host'),
      },
    });

    await waitForIpc();
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-e2e-1', 'thinking');
  });

  test('hooks fire even when shell init prepends paths before wrapper dir', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    // brew-bin simulates the real claude binary installed via brew/npm.
    // It understands --settings (as the real claude does).
    const brewBinDir = path.join(tmpHome, 'brew-bin');
    writeMockClaude(brewBinDir);

    // .bashrc prepends brew-bin (simulates `eval "$(brew shellenv)"`)
    fs.writeFileSync(path.join(tmpHome, '.bashrc'), `export PATH="${brewBinDir}:$PATH"\n`);

    // Shell integration: the rcfile sources .bashrc then re-fixes PATH.
    // Without integration: .bashrc prepends brew-bin before wrapper →
    //   brew claude found first, wrapper never invoked, no hooks.
    // With integration: .bashrc runs, then PATH is re-fixed →
    //   wrapper first, --settings injected, brew claude handles it.
    const integrationDir = path.join(tmpHome, '.config', 'Ouijit', 'shell-integration');
    const rcfile = path.join(integrationDir, 'ouijit-bash-integration.bash');

    // Source the integration script (which sources .bashrc + fixes PATH)
    // then run claude — verifies the PATH fix works end-to-end.
    await exec('/bin/bash', ['-c', `source "${rcfile}" && claude`], {
      env: {
        PATH: `${binDir}:${process.env['PATH'] || ''}`,
        HOME: tmpHome,
        OUIJIT_API_URL: `http://127.0.0.1:${port}`,
        OUIJIT_PTY_ID: 'pty-e2e-2',
        OUIJIT_API_TOKEN: issueToken('pty-e2e-2', 'host'),
        OUIJIT_WRAPPER_DIR: binDir,
        OUIJIT_SHELL_INTEGRATION_DIR: integrationDir,
      },
    });

    await waitForIpc();
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-e2e-2', 'thinking');
  });

  test.skipIf(!hasZsh)('hooks fire in zsh after start hook runs and exec drops into interactive shell', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    // npm-bin simulates the real claude binary (e.g. installed via npm -g).
    const npmBinDir = path.join(tmpHome, 'npm-bin');
    writeMockClaude(npmBinDir);

    // .zshrc that prepends npm-bin (clobbers wrapper position in PATH).
    fs.writeFileSync(path.join(tmpHome, '.zshrc'), `export PATH="${npmBinDir}:$PATH"\n`);

    const integrationDir = path.join(tmpHome, '.config', 'Ouijit', 'shell-integration');

    // Reproduce the real flow when a start hook is configured:
    //   1. zsh -ic 'export PATH=...; <hook_cmd>; exec zsh'
    //   2. The hook command runs (e.g. git fetch && git merge)
    //   3. exec zsh drops into a fresh interactive shell
    //   4. User types `claude` in the new shell
    //
    // The bug: `exec zsh` without ZDOTDIR re-sets means the new zsh
    // doesn't go through the ZDOTDIR trick. The user's .zshrc clobbers
    // PATH and the wrapper is never first. Fix: re-set ZDOTDIR on exec.
    //
    // We simulate `exec zsh` with `zsh -ic '...'` since we can't exec
    // in a test. The inner zsh sources .zshrc (clobbers PATH), then we
    // manually fire precmd (simulating the interactive prompt) and run claude.
    await exec(
      '/bin/zsh',
      [
        '-ic',
        [
          // Outer shell: run the hook command, then "exec" into a new zsh
          'echo "hook: simulating git fetch"',
          // Re-set ZDOTDIR for the inner shell (the fix under test).
          // In production this is: ZDOTDIR="$OUIJIT_SHELL_INTEGRATION_DIR/zsh" exec zsh
          // In test we simulate with a nested zsh -ic + manual precmd.
          `ZDOTDIR="$OUIJIT_SHELL_INTEGRATION_DIR/zsh" /bin/zsh -ic 'for fn in $precmd_functions; do $fn; done && claude'`,
        ].join(' && '),
      ],
      {
        env: {
          PATH: `${binDir}:${process.env['PATH'] || ''}`,
          HOME: tmpHome,
          ZDOTDIR: path.join(integrationDir, 'zsh'),
          OUIJIT_API_URL: `http://127.0.0.1:${port}`,
          OUIJIT_PTY_ID: 'pty-e2e-zsh-hook',
          OUIJIT_API_TOKEN: issueToken('pty-e2e-zsh-hook', 'host'),
          OUIJIT_WRAPPER_DIR: binDir,
          OUIJIT_SHELL_INTEGRATION_DIR: integrationDir,
          OUIJIT_ZSH_ZDOTDIR: '',
        },
      },
    );

    await waitForIpc();
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-e2e-zsh-hook', 'thinking');
  });
});

// ── buildVmHookSettings ──────────────────────────────────────────────

// ── migrateFromSettingsHooks ──────────────────────────────────────────

describe('migrateFromSettingsHooks', () => {
  beforeEach(() => {
    _testHomedir = tmpHome;
  });

  afterEach(() => {
    _testHomedir = '';
  });

  test('strips ouijit hooks from settings.json and writes sentinel', () => {
    // Set up old-style settings.json with ouijit hooks + user hook
    const claudeDir = path.join(tmpHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }] },
          { hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=ready' }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=thinking' }] },
        ],
      },
      someOtherSetting: true,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');

    migrateFromSettingsHooks();

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as HookSettings & { someOtherSetting?: boolean };
    // User hook preserved
    expect(after.hooks!.Stop).toHaveLength(1);
    expect(after.hooks!.Stop![0].hooks[0].command).toBe('/usr/local/bin/user-hook');
    // Ouijit-only event removed entirely
    expect(after.hooks!.UserPromptSubmit).toBeUndefined();
    // Other settings preserved
    expect(after.someOtherSetting).toBe(true);
    // Sentinel file written
    expect(fs.existsSync(path.join(tmpHome, '.config', 'Ouijit', '.migrated-to-wrapper'))).toBe(true);
  });

  test('skips when sentinel file exists', () => {
    // Write sentinel
    const configDir = path.join(tmpHome, '.config', 'Ouijit');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, '.migrated-to-wrapper'), '', 'utf-8');

    // Write settings with ouijit hooks (should NOT be modified)
    const claudeDir = path.join(tmpHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=ready' }] }],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');

    migrateFromSettingsHooks();

    // Settings should be untouched (sentinel blocked migration)
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as HookSettings;
    expect(after.hooks!.Stop).toHaveLength(1);
  });

  test('handles missing settings.json gracefully', () => {
    migrateFromSettingsHooks(); // Should not throw
    // Sentinel should still be written
    expect(fs.existsSync(path.join(tmpHome, '.config', 'Ouijit', '.migrated-to-wrapper'))).toBe(true);
  });

  test('removes stale hooks-version file', () => {
    const configDir = path.join(tmpHome, '.config', 'Ouijit');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'hooks-version'), '13\n', 'utf-8');

    migrateFromSettingsHooks();

    expect(fs.existsSync(path.join(configDir, 'hooks-version'))).toBe(false);
    expect(fs.existsSync(path.join(configDir, '.migrated-to-wrapper'))).toBe(true);
  });

  test('removes hooks key when all entries are ouijit hooks', () => {
    const claudeDir = path.join(tmpHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=ready' }] }],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=thinking' }] },
        ],
      },
      otherKey: 42,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');

    migrateFromSettingsHooks();

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    expect(after.hooks).toBeUndefined();
    expect(after.otherKey).toBe(42);
  });
});

// ── buildVmHookSettings ──────────────────────────────────────────────

describe('buildVmHookSettings', () => {
  test('returns valid JSON', () => {
    const json = buildVmHookSettings();
    const settings = JSON.parse(json) as HookSettings;
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
  });

  test('contains expected hook events', () => {
    const settings = JSON.parse(buildVmHookSettings()) as HookSettings;
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks!.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks!.PostToolUse).toHaveLength(3); // status + plan detection + ExitPlanMode
    expect(settings.hooks!.PostToolUse![1].matcher).toBe('Write|Edit');
    expect(settings.hooks!.PostToolUse![2].matcher).toBe('ExitPlanMode');
    expect(settings.hooks!.Stop).toHaveLength(1);
    expect(settings.hooks!.Notification).toHaveLength(1);
    expect(settings.hooks!.Notification![0].matcher).toBe('permission_prompt|idle_prompt');
  });

  test('commands point to $HOME/ouijit-hook', () => {
    const settings = JSON.parse(buildVmHookSettings()) as HookSettings;
    for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop', 'Notification']) {
      const cmd = settings.hooks![event][0].hooks[0].command;
      expect(cmd).toContain('$HOME/ouijit-hook');
      // Should NOT reference project dir or global config path
      expect(cmd).not.toContain('CLAUDE_PROJECT_DIR');
      expect(cmd).not.toContain('.config/Ouijit');
    }
  });
});

// ── buildVmCodexConfig ───────────────────────────────────────────────

describe('buildVmCodexConfig', () => {
  test('wires notify + the four status hooks via $HOME/ouijit-hook and omits the CLI reference', () => {
    const toml = buildVmCodexConfig();
    expect(toml).toContain('notify = ["bash", "-c", "$HOME/ouijit-hook status status=ready"]');
    expect(toml).toMatch(
      /hooks\.UserPromptSubmit = \[\{hooks=\[\{type="command",command="\$HOME\/ouijit-hook status status=thinking"\}\]\}\]/,
    );
    expect(toml).toMatch(/hooks\.PostToolUse = .+status=thinking/);
    expect(toml).toMatch(/hooks\.Stop = .+status=ready/);
    expect(toml).toMatch(/hooks\.PermissionRequest = .+status=ready/);
    // Codex skips async hooks today ("async hooks are not supported yet")
    expect(toml).not.toContain('async');
    // Sandbox must not get the ouijit CLI reference (lateral-movement concern)
    expect(toml).not.toContain('developer_instructions');
    expect(toml).not.toContain('.config/Ouijit');
  });

  test('the embedded notify array is valid JSON', () => {
    const match = buildVmCodexConfig().match(/notify = (\[.+\])/);
    expect(match).not.toBeNull();
    const notify = JSON.parse(match![1]) as string[];
    expect(notify).toEqual(['bash', '-c', '$HOME/ouijit-hook status status=ready']);
  });
});

// ── buildVmCodexTrustState ───────────────────────────────────────────

describe('buildVmCodexTrustState', () => {
  test('emits a trusted_hash line per event keyed off the VM config path with $HOME literal', () => {
    const toml = buildVmCodexTrustState();
    // $HOME stays literal — the unquoted heredoc in lima/spawn expands it at write time.
    for (const event of ['user_prompt_submit', 'post_tool_use', 'stop', 'permission_request']) {
      const re = new RegExp(
        `hooks\\.state\\."\\$HOME/\\.codex/config\\.toml:${event}:0:0"\\.trusted_hash = "sha256:[0-9a-f]{64}"`,
      );
      expect(toml).toMatch(re);
    }
  });
});

// ── PI_WRAPPER constant ──────────────────────────────────────────────

describe('PI_WRAPPER', () => {
  test('resolves real pi and re-exports wrapper dir on PATH', () => {
    expect(PI_WRAPPER).toContain('WRAPPER_DIR=');
    expect(PI_WRAPPER).toContain('REAL_PI=');
    expect(PI_WRAPPER).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
  });

  test('uses --append-system-prompt for the CLI reference (Pi has no `-c` overrides)', () => {
    expect(PI_WRAPPER).toContain('--append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)"');
    expect(PI_WRAPPER).not.toMatch(/-c '[a-z_]+=/);
  });

  test('loads the extension via --extension and bridges OUIJIT_HOOK_BIN', () => {
    expect(PI_WRAPPER).toMatch(/OUIJIT_HOOK_BIN="\$HOOK_BIN" exec "\$REAL_PI" \\/);
    expect(PI_WRAPPER).toContain('--extension "$EXTENSION_FILE"');
    expect(PI_WRAPPER).toContain('HOOK_BIN="$HOME/.config/Ouijit/bin/ouijit-hook"');
    expect(PI_WRAPPER).toContain('EXTENSION_FILE="$HOME/.config/Ouijit/pi/ouijit-extension.ts"');
  });

  test('falls through with just --append-system-prompt when OUIJIT_API_URL is unset', () => {
    expect(PI_WRAPPER).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(PI_WRAPPER).toContain('exec "$REAL_PI" --append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"');
    // Fallthrough must not carry the extension or hook env var.
    const fallthroughLine = PI_WRAPPER.split('\n').find(
      (l) => l.includes('exec "$REAL_PI" --append-system-prompt') && !l.endsWith('\\'),
    );
    expect(fallthroughLine).toBeDefined();
    expect(fallthroughLine).not.toContain('--extension');
    expect(fallthroughLine).not.toContain('OUIJIT_HOOK_BIN');
  });
});

// ── PI_EXTENSION constant ────────────────────────────────────────────

describe('PI_EXTENSION', () => {
  test('is a TypeScript module with a default-export factory', () => {
    expect(PI_EXTENSION).toMatch(/export default async \(pi: \w+\) =>/);
  });

  test('subscribes turn_start → thinking and turn_end → ready exactly once each', () => {
    expect(PI_EXTENSION.match(/pi\.on\('turn_start'/g)).toHaveLength(1);
    expect(PI_EXTENSION.match(/pi\.on\('turn_end'/g)).toHaveLength(1);
    expect(PI_EXTENSION).toContain("ping('thinking')");
    expect(PI_EXTENSION).toContain("ping('ready')");
  });

  test('no-ops when OUIJIT_HOOK_BIN is unset (safe outside Ouijit)', () => {
    expect(PI_EXTENSION).toMatch(/const hookBin = process\.env\.OUIJIT_HOOK_BIN/);
    expect(PI_EXTENSION).toMatch(/if \(!hookBin\) return/);
  });

  test('shells out to ouijit-hook via pi.exec with a timeout and swallows errors', () => {
    expect(PI_EXTENSION).toMatch(/pi\.exec\(hookBin, \['status', .* \{ timeout: 2000 \}\)/);
    expect(PI_EXTENSION).toContain('.catch(() => {})');
  });
});

// ── buildVmPiExtension ───────────────────────────────────────────────

describe('buildVmPiExtension', () => {
  test('matches the host-side extension exactly', () => {
    expect(buildVmPiExtension()).toBe(PI_EXTENSION);
  });

  test('omits any reference to the host-only CLI reference file', () => {
    // Lateral-movement: agent in sandbox must not get the CLI.
    const ext = buildVmPiExtension();
    expect(ext).not.toContain('ouijit-cli-reference');
    expect(ext).not.toContain('.config/Ouijit');
  });
});
