import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { BrowserWindow } from 'electron';

// Mutable homedir for install tests — must be declared before vi.mock
let _testHomedir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: () => _testHomedir || actual.homedir(),
  };
});

import {
  startHookServer,
  stopHookServer,
  getApiPort,
  installWrapper,
  migrateFromSettingsHooks,
  buildVmHookSettings,
  CLAUDE_WRAPPER,
} from '../hookServer';

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

function post(
  port: number,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      http.get(`http://127.0.0.1:${port}/hook`, (res) => resolve(res.statusCode!))
        .on('error', reject);
    });
    expect(res).toBe(404);

    // POST to wrong path
    const res2 = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/other', method: 'POST' },
        (res) => resolve(res.statusCode!),
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
      req.write('not-json{{{');
      req.end();
    });
    expect(res).toBe(400);
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
    expect(mockSend).toHaveBeenCalledWith('claude-hook-status', 'pty-123', 'thinking');
  });

  test('sends IPC for valid ready status', async () => {
    await post(port, { action: 'status', ptyId: 'pty-789', status: 'ready' });
    expect(mockSend).toHaveBeenCalledWith('claude-hook-status', 'pty-789', 'ready');
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
    expect(wrapper).toContain('exec claude --settings');
    expect(wrapper).toContain('ouijit-hook');
  });

  test('wrapper falls through when OUIJIT_API_URL is unset', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'claude');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    // Contains the fallthrough: exec claude "$@" without --settings
    expect(wrapper).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(wrapper).toContain('exec claude "$@"');
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
    expect(settings.hooks!.PostToolUse).toHaveLength(1);
    expect(settings.hooks!.Stop).toHaveLength(1);
    expect(settings.hooks!.Notification).toHaveLength(1);
    expect(settings.hooks!.Notification![0].matcher).toBe('permission_prompt|idle_prompt');
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
  test('removes its own directory from PATH', () => {
    expect(CLAUDE_WRAPPER).toContain('WRAPPER_DIR=');
    expect(CLAUDE_WRAPPER).toContain('PATH="${PATH//:$WRAPPER_DIR:/:}"');
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
    const result = await exec('bash', ['-c', [
      'WRAPPER_DIR="/home/user/.config/Ouijit/bin"',
      'PATH="/usr/bin:/home/user/.config/Ouijit/bin:/usr/local/bin"',
      'PATH=":$PATH:"',
      'PATH="${PATH//:$WRAPPER_DIR:/:}"',
      'PATH="${PATH#:}"',
      'PATH="${PATH%:}"',
      'echo "$PATH"',
    ].join('\n')]);

    expect(result.stdout.trim()).toBe('/usr/bin:/usr/local/bin');
  });

  test('PATH self-removal strips the wrapper dir (duplicate occurrences)', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    const result = await exec('bash', ['-c', [
      'WRAPPER_DIR="/home/user/.config/Ouijit/bin"',
      'PATH="/home/user/.config/Ouijit/bin:/usr/bin:/home/user/.config/Ouijit/bin:/usr/local/bin"',
      'PATH=":$PATH:"',
      'PATH="${PATH//:$WRAPPER_DIR:/:}"',
      'PATH="${PATH#:}"',
      'PATH="${PATH%:}"',
      'echo "$PATH"',
    ].join('\n')]);

    expect(result.stdout.trim()).toBe('/usr/bin:/usr/local/bin');
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
        Stop: [
          { hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=ready' }] },
        ],
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
        Stop: [
          { hooks: [{ type: 'command', command: '$HOME/.config/Ouijit/bin/ouijit-hook status status=ready' }] },
        ],
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
    expect(settings.hooks!.PostToolUse).toHaveLength(1);
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
