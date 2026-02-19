import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { BrowserWindow } from 'electron';

// Mutable homedir for install/uninstall tests — must be declared before vi.mock
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
  installHooks,
  uninstallHooks,
  isOuijitHook,
  buildVmHookSettings,
  cleanupProjectHookArtifacts,
  HOOK_VERSION,
  type ClaudeHookMatcher,
  type ClaudeSettings,
} from '../hookServer';

// ── Test helpers ─────────────────────────────────────────────────────

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

// Temp directory for install/uninstall tests
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

  test('sends IPC for valid idle status', async () => {
    await post(port, { action: 'status', ptyId: 'pty-456', status: 'idle' });
    expect(mockSend).toHaveBeenCalledWith('claude-hook-status', 'pty-456', 'idle');
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

// ── isOuijitHook ─────────────────────────────────────────────────────

describe('isOuijitHook', () => {
  test('detects ouijit hook entries', () => {
    const entry: ClaudeHookMatcher = {
      hooks: [{ type: 'command', command: '~/.config/Ouijit/bin/ouijit-hook status status=thinking' }],
    };
    expect(isOuijitHook(entry)).toBe(true);
  });

  test('rejects non-ouijit entries', () => {
    const entry: ClaudeHookMatcher = {
      hooks: [{ type: 'command', command: '/usr/local/bin/my-hook' }],
    };
    expect(isOuijitHook(entry)).toBe(false);
  });

  test('handles empty hooks array', () => {
    const entry: ClaudeHookMatcher = { hooks: [] };
    expect(isOuijitHook(entry)).toBe(false);
  });
});

// ── installHooks ─────────────────────────────────────────────────────

describe('installHooks', () => {
  beforeEach(() => {
    _testHomedir = tmpHome;
    // Simulate Claude Code being installed
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  });

  afterEach(() => {
    _testHomedir = '';
  });

  test('skips if Claude Code is not installed', () => {
    // Remove .claude dir to simulate no Claude Code
    fs.rmSync(path.join(tmpHome, '.claude'), { recursive: true });

    installHooks();

    // Neither helper script nor version marker should be created
    expect(fs.existsSync(path.join(tmpHome, '.config', 'Ouijit', 'bin', 'ouijit-hook'))).toBe(false);
    expect(fs.existsSync(path.join(tmpHome, '.claude'))).toBe(false);
  });

  test('creates helper script and settings on first install', () => {
    installHooks();

    // Helper script exists and is executable content
    const scriptPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'ouijit-hook');
    const script = fs.readFileSync(scriptPath, 'utf-8');
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('OUIJIT_API_URL');
    expect(script).toContain('OUIJIT_PTY_ID');
    // Input validation present
    expect(script).toContain('[a-zA-Z0-9._-]+');
    // No auth token references
    expect(script).not.toContain('Authorization');
    expect(script).not.toContain('OUIJIT_API_TOKEN');

    // Settings file has hooks
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks!.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks!.PostToolUse).toHaveLength(1);
    expect(settings.hooks!.Stop).toHaveLength(1);
    expect(settings.hooks!.Notification).toHaveLength(1);
    expect(settings.hooks!.Notification![0].matcher).toBe('permission_prompt|idle_prompt');

    // Version marker written
    const versionPath = path.join(tmpHome, '.config', 'Ouijit', 'hooks-version');
    expect(fs.readFileSync(versionPath, 'utf-8').trim()).toBe(String(HOOK_VERSION));
  });

  test('skips reinstall when version matches', () => {
    installHooks();

    // Modify settings to verify it does NOT get rewritten
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    settings.custom = 'marker';
    fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');

    installHooks();

    // Custom marker should still be there (file not rewritten)
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    expect(after.custom).toBe('marker');
  });

  test('reinstalls when version changes', () => {
    installHooks();

    // Simulate a version bump by writing a different version
    const versionPath = path.join(tmpHome, '.config', 'Ouijit', 'hooks-version');
    fs.writeFileSync(versionPath, '0\n', 'utf-8');

    installHooks();

    // Version should be updated
    expect(fs.readFileSync(versionPath, 'utf-8').trim()).toBe(String(HOOK_VERSION));
  });

  test('preserves existing user hooks', () => {
    // Pre-populate with user hooks
    const claudeDir = path.join(tmpHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    const existing: ClaudeSettings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/usr/local/bin/my-stop-hook' }] },
        ],
      },
      someOtherSetting: true,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existing), 'utf-8');

    installHooks();

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    // User hook preserved
    expect(settings.hooks!.Stop).toHaveLength(2);
    expect(settings.hooks!.Stop![0].hooks[0].command).toBe('/usr/local/bin/my-stop-hook');
    // Ouijit hook appended
    expect(settings.hooks!.Stop![1].hooks[0].command).toContain('ouijit-hook');
    // Other settings preserved
    expect(settings.someOtherSetting).toBe(true);
  });

  test('replaces stale ouijit hooks on reinstall', () => {
    installHooks();

    // Bump version to force reinstall
    const versionPath = path.join(tmpHome, '.config', 'Ouijit', 'hooks-version');
    fs.writeFileSync(versionPath, '0\n', 'utf-8');

    installHooks();

    // Should have exactly one ouijit hook per event, not duplicates
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    expect(settings.hooks!.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks!.PostToolUse).toHaveLength(1);
    expect(settings.hooks!.Stop).toHaveLength(1);
    expect(settings.hooks!.Notification).toHaveLength(1);
  });
});

// ── uninstallHooks ───────────────────────────────────────────────────

describe('uninstallHooks', () => {
  beforeEach(() => {
    _testHomedir = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    installHooks();
  });

  afterEach(() => {
    _testHomedir = '';
  });

  test('removes ouijit hooks from settings.json', () => {
    uninstallHooks();

    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    // hooks key should be removed entirely since it's now empty
    expect(settings.hooks).toBeUndefined();
  });

  test('preserves non-ouijit hooks in settings.json', () => {
    // Add a user hook alongside ouijit hooks
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    settings.hooks!.Stop!.unshift({
      hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }],
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');

    uninstallHooks();

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    // Stop event still has user hook, ouijit hook removed
    expect(after.hooks!.Stop).toHaveLength(1);
    expect(after.hooks!.Stop![0].hooks[0].command).toBe('/usr/local/bin/user-hook');
    // Events that only had ouijit hooks are removed
    expect(after.hooks!.UserPromptSubmit).toBeUndefined();
    expect(after.hooks!.Notification).toBeUndefined();
  });

  test('removes helper script', () => {
    const scriptPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'ouijit-hook');
    expect(fs.existsSync(scriptPath)).toBe(true);

    uninstallHooks();
    expect(fs.existsSync(scriptPath)).toBe(false);
  });

  test('removes version marker', () => {
    const versionPath = path.join(tmpHome, '.config', 'Ouijit', 'hooks-version');
    expect(fs.existsSync(versionPath)).toBe(true);

    uninstallHooks();
    expect(fs.existsSync(versionPath)).toBe(false);
  });

  test('is idempotent (safe to call twice)', () => {
    uninstallHooks();
    uninstallHooks(); // Should not throw
  });

  test('handles missing settings file gracefully', () => {
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    fs.unlinkSync(settingsPath);
    uninstallHooks(); // Should not throw
  });
});

// ── buildVmHookSettings ──────────────────────────────────────────────

describe('buildVmHookSettings', () => {
  test('returns valid JSON', () => {
    const json = buildVmHookSettings();
    const settings = JSON.parse(json) as ClaudeSettings;
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
  });

  test('contains expected hook events', () => {
    const settings = JSON.parse(buildVmHookSettings()) as ClaudeSettings;
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks!.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks!.PostToolUse).toHaveLength(1);
    expect(settings.hooks!.Stop).toHaveLength(1);
    expect(settings.hooks!.Notification).toHaveLength(1);
    expect(settings.hooks!.Notification![0].matcher).toBe('permission_prompt|idle_prompt');
  });

  test('commands point to $HOME/ouijit-hook', () => {
    const settings = JSON.parse(buildVmHookSettings()) as ClaudeSettings;
    for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop', 'Notification']) {
      const cmd = settings.hooks![event][0].hooks[0].command;
      expect(cmd).toContain('$HOME/ouijit-hook');
      // Should NOT reference project dir or global config path
      expect(cmd).not.toContain('CLAUDE_PROJECT_DIR');
      expect(cmd).not.toContain('.config/Ouijit');
    }
  });
});

// ── cleanupProjectHookArtifacts ──────────────────────────────────────

describe('cleanupProjectHookArtifacts', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('removes hook script and version file', () => {
    const hooksDir = path.join(projectDir, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'ouijit-hook'), '#!/bin/bash\n', { mode: 0o755 });
    fs.writeFileSync(path.join(hooksDir, '.ouijit-hooks-version'), '4\n');

    cleanupProjectHookArtifacts(projectDir);

    expect(fs.existsSync(path.join(hooksDir, 'ouijit-hook'))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, '.ouijit-hooks-version'))).toBe(false);
  });

  test('removes empty hooks directory', () => {
    const hooksDir = path.join(projectDir, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'ouijit-hook'), '#!/bin/bash\n');

    cleanupProjectHookArtifacts(projectDir);

    expect(fs.existsSync(hooksDir)).toBe(false);
  });

  test('preserves hooks directory if it has other files', () => {
    const hooksDir = path.join(projectDir, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'ouijit-hook'), '#!/bin/bash\n');
    fs.writeFileSync(path.join(hooksDir, 'user-hook.sh'), '#!/bin/bash\necho hi\n');

    cleanupProjectHookArtifacts(projectDir);

    expect(fs.existsSync(path.join(hooksDir, 'ouijit-hook'))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, 'user-hook.sh'))).toBe(true);
    expect(fs.existsSync(hooksDir)).toBe(true);
  });

  test('strips ouijit hooks from settings.local.json', () => {
    const claudeDir = path.join(projectDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.local.json');
    const settings: ClaudeSettings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }] },
          { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/ouijit-hook" status status=idle' }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/ouijit-hook" status status=thinking' }] },
        ],
      },
      someOtherSetting: true,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');

    cleanupProjectHookArtifacts(projectDir);

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    // User hook preserved
    expect(after.hooks!.Stop).toHaveLength(1);
    expect(after.hooks!.Stop![0].hooks[0].command).toBe('/usr/local/bin/user-hook');
    // Ouijit-only event removed
    expect(after.hooks!.UserPromptSubmit).toBeUndefined();
    // Other settings preserved
    expect(after.someOtherSetting).toBe(true);
  });

  test('deletes settings.local.json when empty after cleanup', () => {
    const claudeDir = path.join(projectDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.local.json');
    const settings: ClaudeSettings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/ouijit-hook" status status=idle' }] },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');

    cleanupProjectHookArtifacts(projectDir);

    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  test('handles missing .claude directory gracefully', () => {
    cleanupProjectHookArtifacts(projectDir); // Should not throw
  });

  test('handles missing settings.local.json gracefully', () => {
    fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
    cleanupProjectHookArtifacts(projectDir); // Should not throw
  });

  test('is idempotent', () => {
    const hooksDir = path.join(projectDir, '.claude', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'ouijit-hook'), '#!/bin/bash\n');

    cleanupProjectHookArtifacts(projectDir);
    cleanupProjectHookArtifacts(projectDir); // Should not throw
  });
});
