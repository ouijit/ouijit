import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as ts from 'typescript';
import type { BrowserWindow } from 'electron';

import {
  startHookServer,
  stopHookServer,
  getApiPort,
  installWrapper,
  migrateFromSettingsHooks,
  CLAUDE_WRAPPER,
  CODEX_WRAPPER,
  PI_WRAPPER,
  PI_EXTENSION,
  OPENCODE_WRAPPER,
  OPENCODE_PLUGIN,
  NONO_SHIM,
  CLI_REFERENCE,
} from '../hookServer';
import { issueToken, revokeAllTokens } from '../apiAuth';

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

// `paths` is already evaluated by the time this file's `node:os` mock lands —
// the DB layer imports it from the test setup — so the wrapper dir has to be
// pointed at the temporary home directly.
vi.mock('../paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paths')>()),
  getWrapperBinDir: () => path.join(_testHomedir || os.homedir(), '.config', 'Ouijit', 'bin'),
}));

vi.mock('../ptyManager', () => ({
  isPtyActive: () => true,
}));

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

/**
 * This reference is the only thing an agent is told about Ouijit, so a
 * capability it does not name is one the agent cannot know exists.
 */
describe('CLI_REFERENCE', () => {
  test('names every capability an agent can only learn from it', () => {
    expect(CLI_REFERENCE).toContain('ouijit pr draft add');
    expect(CLI_REFERENCE).toContain('ouijit pr lens set');
    // How to find which pull request it is on: the task carries the number.
    expect(CLI_REFERENCE).toContain('ouijit task current | jq .githubPrNumber');

    // The anchoring rule a whole review fails on.
    expect(CLI_REFERENCE).toContain('ADDED line');

    expect(CLI_REFERENCE).toContain('ouijit sandbox-command set');
    // Sandboxed agents read the same reference, so it has to say what it cannot run.
    expect(CLI_REFERENCE).toContain('host terminals only');
  });

  test('documents the ouijit CLI and no other tool', () => {
    expect(CLI_REFERENCE).not.toMatch(/\bgh\b/);
  });
});

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

// ── Plan detection (removed) ─────────────────────────────────────────

// Markdown panels are opened by the user (the "+" menu or `ouijit markdown
// add`), never by an agent writing a file. Nothing may push a panel onto a
// terminal on its own — no hook to fire it, and no server action if one does.
describe('plan detection', () => {
  test('nothing installs or answers a plan hook', async () => {
    _testHomedir = tmpHome;
    const binDir = path.join(tmpHome, '.config', 'Ouijit', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    // A plan hook left behind by an older install must be cleaned up.
    fs.writeFileSync(path.join(binDir, 'ouijit-plan-hook'), '#!/bin/bash\n', { mode: 0o755 });
    fs.mkdirSync(path.join(tmpHome, '.claude', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.claude', 'plans', 'a-plan.md'), '# Plan\n');

    await startHookServer(createMockWindow());
    installWrapper();

    expect(fs.existsSync(path.join(binDir, 'ouijit-plan-hook'))).toBe(false);
    expect(fs.readFileSync(path.join(binDir, 'claude'), 'utf-8')).not.toContain('plan-hook');

    // And an older hook script still calling in gets a silent 200.
    const port = getApiPort();
    for (const action of ['plan', 'plan-ready']) {
      const res = await post(port, { action, ptyId: 'pty-plan-1', filename: 'a-plan.md' });
      expect(res.status).toBe(200);
    }
    expect(mockSend).not.toHaveBeenCalled();

    _testHomedir = '';
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
    expect(wrapper).toContain('exec "$REAL_BIN" --settings');
    expect(wrapper).toContain('ouijit-hook');
  });

  test('wrapper falls through when OUIJIT_API_URL is unset', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'claude');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    // Contains the fallthrough: exec real claude without --settings but with reference file
    expect(wrapper).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(wrapper).toContain('exec "$REAL_BIN" --append-system-prompt-file "$REFERENCE_FILE" "$@"');
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

  test('creates codex wrapper on first install', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'codex');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    expect(wrapper).toContain('#!/bin/bash');
    expect(wrapper).toContain('REAL_BIN=');
    expect(wrapper).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
    // Injects the CLI reference + lifecycle hooks + per-hook pre-trust + notify via -c overrides
    expect(wrapper).toContain('-c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)"');
    expect(wrapper).toContain("-c 'hooks.UserPromptSubmit=");
    expect(wrapper).toContain("-c 'hooks.PostToolUse=");
    expect(wrapper).toContain("-c 'hooks.Stop=");
    expect(wrapper).toContain('-c \'hooks.state."/<session-flags>/config.toml:user_prompt_submit:0:0".trusted_hash=');
    expect(wrapper).toContain('-c \'hooks.state."/<session-flags>/config.toml:stop:0:0".trusted_hash=');
    expect(wrapper).toContain("-c 'notify=");
    // No-API fallthrough still passes developer_instructions
    expect(wrapper).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(wrapper).toContain('exec "$REAL_BIN" -c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"');
  });

  test('creates pi wrapper and extension on first install', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'pi');
    const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
    expect(wrapper).toContain('#!/bin/bash');
    expect(wrapper).toContain('REAL_BIN=');
    expect(wrapper).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
    expect(wrapper).toContain('--append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)"');
    expect(wrapper).toContain('--extension "$EXTENSION_FILE"');
    expect(wrapper).toContain('OUIJIT_HOOK_BIN="$HOOK_BIN" exec "$REAL_BIN"');
    expect(wrapper).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(wrapper).toContain('exec "$REAL_BIN" --append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"');

    const extPath = path.join(tmpHome, '.config', 'Ouijit', 'pi', 'ouijit-extension.ts');
    expect(fs.existsSync(extPath)).toBe(true);
    const ext = fs.readFileSync(extPath, 'utf-8');
    expect(ext).toContain('export default');
    expect(ext).toContain("pi.on('agent_start'");
    expect(ext).toContain("pi.on('agent_end'");
    expect(ext).toContain('OUIJIT_HOOK_BIN');
  });

  test('creates opencode wrapper and status plugin on first install', () => {
    installWrapper();

    const wrapperPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'opencode');
    expect(fs.readFileSync(wrapperPath, 'utf-8')).toBe(OPENCODE_WRAPPER);

    const pluginPath = path.join(tmpHome, '.config', 'opencode', 'plugins', 'ouijit.ts');
    expect(fs.readFileSync(pluginPath, 'utf-8')).toBe(OPENCODE_PLUGIN);
  });

  test('creates nono shim preferring OUIJIT_NONO_PATH with a PATH fallthrough', () => {
    installWrapper();

    const shimPath = path.join(tmpHome, '.config', 'Ouijit', 'bin', 'nono');
    const shim = fs.readFileSync(shimPath, 'utf-8');
    expect(shim).toContain('#!/bin/bash');
    // Sandboxed sessions: exec the vendored binary the provider injected.
    expect(shim).toContain('exec "$OUIJIT_NONO_PATH" "$@"');
    // Everywhere else: resolve the real nono on PATH via the shared resolver.
    expect(shim).toContain('REAL_BIN=');
    expect(shim).toContain('exec "$REAL_BIN" "$@"');
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
    expect(content).toContain('ouijit markdown add');
    expect(content).toContain('ouijit preview add');
    expect(content).toContain('ouijit project list');
    // Contains env var documentation
    expect(content).toContain('OUIJIT_API_URL');
    expect(content).toContain('OUIJIT_PTY_ID');
  });

  test('does not require ~/.claude to exist', () => {
    // The wrapper installs on a machine that has never run Claude Code.
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

// ── Shared wrapper resolver (claude / codex / pi) ────────────────────

describe('wrapper resolver (shared)', () => {
  // Each entry: [wrapper label, wrapper source, binary name, sentinel the
  // wrapper injects when OUIJIT_API_URL is unset]. The injection sentinel
  // lets us confirm the wrapper still wrapped — that we didn't accidentally
  // skip everything to dodge recursion.
  const wrappers: Array<[string, string, string, RegExp]> = [
    ['claude', CLAUDE_WRAPPER, 'claude', /--append-system-prompt-file/],
    ['codex', CODEX_WRAPPER, 'codex', /developer_instructions=/],
    ['pi', PI_WRAPPER, 'pi', /--append-system-prompt/],
  ];

  for (const [label, wrapper, bin, injectedSentinel] of wrappers) {
    test(`${label} wrapper: does not recurse into itself when PATH lists the wrapper dir twice (regression for T-407)`, () => {
      // Reproduces the reported failure mode: the wrapper dir appears twice
      // in PATH (once verbatim, once via a symlink) so the string-only strip
      // leaves a wrapper-pointing entry behind. Pre-fix the wrapper exec's
      // itself, argv balloons across each hop, and execve fails with E2BIG.
      // Post-fix the `-ef` guard rejects the wrapper match and we resolve
      // the real binary.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `wrapper-resolver-${label}-`));
      try {
        const wrapperDir = path.join(tmp, 'wrapper-bin');
        const realDir = path.join(tmp, 'real-bin');
        fs.mkdirSync(wrapperDir);
        fs.mkdirSync(realDir);

        fs.writeFileSync(path.join(wrapperDir, bin), wrapper, { mode: 0o755 });

        // Real-binary stand-in: prints a sentinel then echoes its argv so we
        // can also assert the wrapper passed through the expected injection.
        fs.writeFileSync(path.join(realDir, bin), '#!/bin/bash\necho REAL_BIN_OK\nprintf "%s\\n" "$@"\n', {
          mode: 0o755,
        });

        // Symlink with a different spelling that the strip pattern misses.
        const wrapperDirSymlink = path.join(tmp, 'wrapper-bin-link');
        fs.symlinkSync(wrapperDir, wrapperDirSymlink);

        // PATH: wrapper verbatim, real dir, wrapper via symlink, plus the
        // system dirs so dirname/basename are reachable.
        const fakePath = [wrapperDir, realDir, wrapperDirSymlink, '/usr/bin', '/bin'].join(':');

        const result = execFileSync('bash', [path.join(wrapperDir, bin), 'hello'], {
          env: {
            PATH: fakePath,
            HOME: tmp,
            // Force the no-OUIJIT_API_URL branch — keeps the injected argv
            // small and predictable across the three wrappers.
            OUIJIT_API_URL: '',
          },
          encoding: 'utf8',
          timeout: 10_000,
        });

        expect(result).toContain('REAL_BIN_OK');
        expect(result).toMatch(injectedSentinel);
        expect(result).toContain('hello');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});

describe('NONO_SHIM', () => {
  test('execs the vendored binary when OUIJIT_NONO_PATH is set, else the real nono on PATH', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nono-shim-'));
    try {
      const wrapperDir = path.join(tmp, 'wrapper-bin');
      const realDir = path.join(tmp, 'real-bin');
      fs.mkdirSync(wrapperDir);
      fs.mkdirSync(realDir);
      const shimPath = path.join(wrapperDir, 'nono');
      fs.writeFileSync(shimPath, NONO_SHIM, { mode: 0o755 });

      // Stand-ins for the vendored binary (as the app resources would hold it)
      // and a user-installed nono on PATH.
      const vendored = path.join(tmp, 'vendored-nono');
      fs.writeFileSync(vendored, '#!/bin/bash\necho VENDORED_OK\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
      fs.writeFileSync(path.join(realDir, 'nono'), '#!/bin/bash\necho PATH_NONO_OK\n', { mode: 0o755 });

      const fakePath = [wrapperDir, realDir, '/usr/bin', '/bin'].join(':');

      // Sandboxed session: the provider-injected env var wins and argv passes through.
      const sandboxed = execFileSync('bash', [shimPath, 'why', '--path', '/x'], {
        env: { PATH: fakePath, HOME: tmp, OUIJIT_NONO_PATH: vendored },
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(sandboxed).toContain('VENDORED_OK');
      expect(sandboxed).toContain('why');

      // Host session (no env var): falls through to the user's nono on PATH.
      const host = execFileSync('bash', [shimPath, 'why'], {
        env: { PATH: fakePath, HOME: tmp },
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(host).toContain('PATH_NONO_OK');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── CLAUDE_WRAPPER constant ──────────────────────────────────────────

describe('CLAUDE_WRAPPER', () => {
  test('resolves real claude and re-exports wrapper dir on PATH', () => {
    expect(CLAUDE_WRAPPER).toContain('WRAPPER_DIR=');
    expect(CLAUDE_WRAPPER).toContain('REAL_BIN=');
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

  describe('subcommand passthrough (issue #177)', () => {
    const runWrapper = (args: string[], extraEnv: Record<string, string> = {}) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wrapper-test-'));
      const wrapperDir = path.join(root, 'wrapper');
      const stubDir = path.join(root, 'stub');
      fs.mkdirSync(wrapperDir);
      fs.mkdirSync(stubDir);
      const argvLog = path.join(root, 'argv.log');
      fs.writeFileSync(path.join(wrapperDir, 'claude'), CLAUDE_WRAPPER, { mode: 0o755 });
      fs.writeFileSync(
        path.join(stubDir, 'claude'),
        `#!/bin/bash\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; done\n`,
        { mode: 0o755 },
      );
      try {
        execFileSync(path.join(wrapperDir, 'claude'), args, {
          env: {
            PATH: `${wrapperDir}:${stubDir}:/usr/bin:/bin`,
            HOME: root,
            ...extraEnv,
          },
          encoding: 'utf8',
        });
        const argv = fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf8').replace(/\n$/, '').split('\n') : [];
        return { argv };
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    };

    test('`claude update` passes through with no --settings / --append-system-prompt-file', () => {
      const { argv } = runWrapper(['update'], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toEqual(['update']);
    });

    test('`claude mcp serve` passes through unchanged', () => {
      const { argv } = runWrapper(['mcp', 'serve'], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toEqual(['mcp', 'serve']);
    });

    test('bare `claude` still gets --settings and --append-system-prompt-file', () => {
      const { argv } = runWrapper([], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toContain('--settings');
      expect(argv).toContain('--append-system-prompt-file');
    });

    test('`claude <message>` (non-subcommand first arg) still gets injection', () => {
      const { argv } = runWrapper(['hello world'], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toContain('--settings');
      expect(argv).toContain('--append-system-prompt-file');
      expect(argv).toContain('hello world');
    });
  });
});

// ── CODEX_WRAPPER constant ───────────────────────────────────────────

describe('CODEX_WRAPPER', () => {
  test('resolves real codex and re-exports wrapper dir on PATH', () => {
    expect(CODEX_WRAPPER).toContain('WRAPPER_DIR=');
    expect(CODEX_WRAPPER).toContain('REAL_BIN=');
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

  test('maps thinking to the events that start work and ready to turn end alone', () => {
    const tables = [...CODEX_WRAPPER.matchAll(/-c 'hooks\.(\w+)=(\[\{hooks=\[\{[^']+\}\]\}\])' \\/g)];

    // Exhaustive on purpose: PermissionRequest reads like a ready signal and
    // codex-rs fires it mid-turn, so a second ready event is the regression
    // this pins.
    expect(tables.map(([, event, table]) => `${event}=${table.match(/status=(\w+)"/)![1]}`)).toEqual([
      'UserPromptSubmit=thinking',
      'PostToolUse=thinking',
      'Stop=ready',
    ]);

    for (const [, event, table] of tables) {
      // Codex parses -c values as TOML; a JSON object fails to parse, degrades
      // to a string, and then fails typed deserialization.
      expect(table, `hooks.${event} must be a TOML inline table, not JSON`).not.toMatch(/"[A-Za-z_]+":/);
      // Codex skips async hooks today ("async hooks are not supported yet")
      expect(table, `hooks.${event} must not be async`).not.toContain('async');
      expect(table).toContain('command="$HOME/.config/Ouijit/bin/ouijit-hook status status=');
    }
  });

  test('falls through with just developer_instructions when OUIJIT_API_URL is unset', () => {
    expect(CODEX_WRAPPER).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(CODEX_WRAPPER).toContain(
      'exec "$REAL_BIN" -c "developer_instructions=$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"',
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

  test.skipIf(!hasZsh)('hooks fire in zsh when a start hook runs claude as the startup command', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    // npm-bin simulates the real claude binary (e.g. installed via npm -g).
    const npmBinDir = path.join(tmpHome, 'npm-bin');
    writeMockClaude(npmBinDir);

    // .zshrc that prepends npm-bin (clobbers wrapper position in PATH).
    fs.writeFileSync(path.join(tmpHome, '.zshrc'), `export PATH="${npmBinDir}:$PATH"\n`);

    const integrationDir = path.join(tmpHome, '.config', 'Ouijit', 'shell-integration');

    // The integration runs the startup command from the first prompt, after
    // .zshrc. `-c` never draws a prompt, so the precmd hooks are fired by hand.
    await exec('/bin/zsh', ['-ic', 'for fn in $precmd_functions; do $fn; done'], {
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
        OUIJIT_STARTUP_COMMAND: 'claude',
      },
    });

    await waitForIpc();
    expect(mockSend).toHaveBeenCalledWith('agent-hook-status', 'pty-e2e-zsh-hook', 'thinking');
  });
});

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

// ── PI_WRAPPER constant ──────────────────────────────────────────────

describe('PI_WRAPPER', () => {
  test('resolves real pi and re-exports wrapper dir on PATH', () => {
    expect(PI_WRAPPER).toContain('WRAPPER_DIR=');
    expect(PI_WRAPPER).toContain('REAL_BIN=');
    expect(PI_WRAPPER).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
  });

  test('uses --append-system-prompt for the CLI reference (Pi has no `-c` overrides)', () => {
    expect(PI_WRAPPER).toContain('--append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)"');
    expect(PI_WRAPPER).not.toMatch(/-c '[a-z_]+=/);
  });

  test('loads the extension via --extension and bridges OUIJIT_HOOK_BIN', () => {
    expect(PI_WRAPPER).toMatch(/OUIJIT_HOOK_BIN="\$HOOK_BIN" exec "\$REAL_BIN" \\/);
    expect(PI_WRAPPER).toContain('--extension "$EXTENSION_FILE"');
    expect(PI_WRAPPER).toContain('HOOK_BIN="$HOME/.config/Ouijit/bin/ouijit-hook"');
    expect(PI_WRAPPER).toContain('EXTENSION_FILE="$HOME/.config/Ouijit/pi/ouijit-extension.ts"');
  });

  test('falls through with just --append-system-prompt when OUIJIT_API_URL is unset', () => {
    expect(PI_WRAPPER).toContain('if [ -z "$OUIJIT_API_URL" ]; then');
    expect(PI_WRAPPER).toContain('exec "$REAL_BIN" --append-system-prompt "$(cat "$REFERENCE_FILE" 2>/dev/null)" "$@"');
    // Fallthrough must not carry the extension or hook env var.
    const fallthroughLine = PI_WRAPPER.split('\n').find(
      (l) => l.includes('exec "$REAL_BIN" --append-system-prompt') && !l.endsWith('\\'),
    );
    expect(fallthroughLine).toBeDefined();
    expect(fallthroughLine).not.toContain('--extension');
    expect(fallthroughLine).not.toContain('OUIJIT_HOOK_BIN');
  });

  describe('subcommand passthrough (issue #177)', () => {
    // Render PI_WRAPPER to a temp wrapper dir, plant a stub `pi` in a
    // separate dir so CLEAN_PATH (which strips the wrapper dir) can still
    // resolve it. The stub appends its argv to a log file, one per line.
    const runWrapper = (args: string[], extraEnv: Record<string, string> = {}) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-wrapper-test-'));
      const wrapperDir = path.join(root, 'wrapper');
      const stubDir = path.join(root, 'stub');
      fs.mkdirSync(wrapperDir);
      fs.mkdirSync(stubDir);
      const argvLog = path.join(root, 'argv.log');
      fs.writeFileSync(path.join(wrapperDir, 'pi'), PI_WRAPPER, { mode: 0o755 });
      fs.writeFileSync(
        path.join(stubDir, 'pi'),
        `#!/bin/bash\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; done\n`,
        { mode: 0o755 },
      );
      try {
        const result = execFileSync(path.join(wrapperDir, 'pi'), args, {
          env: {
            PATH: `${wrapperDir}:${stubDir}:/usr/bin:/bin`,
            HOME: root,
            ...extraEnv,
          },
          encoding: 'utf8',
        });
        const argv = fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf8').replace(/\n$/, '').split('\n') : [];
        return { argv, stdout: result };
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    };

    test('`pi update` passes through with no injection', () => {
      const { argv } = runWrapper(['update'], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toEqual(['update']);
    });

    test('`pi install foo` passes through with no injection', () => {
      const { argv } = runWrapper(['install', 'foo'], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toEqual(['install', 'foo']);
    });

    test('all known subcommands (install/remove/uninstall/update/list/config) pass through clean', () => {
      for (const sub of ['install', 'remove', 'uninstall', 'update', 'list', 'config']) {
        const { argv } = runWrapper([sub], { OUIJIT_API_URL: 'http://stub' });
        expect(argv, `subcommand ${sub} should pass through unchanged`).toEqual([sub]);
      }
    });

    test('leading flags do not get mistaken for a subcommand', () => {
      // `pi --version` is not a known subcommand → falls through to injection.
      const { argv } = runWrapper(['--version'], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toContain('--append-system-prompt');
      expect(argv).toContain('--extension');
      expect(argv).toContain('--version');
    });

    test('bare `pi` (no args) still gets --append-system-prompt and --extension', () => {
      const { argv } = runWrapper([], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toContain('--append-system-prompt');
      expect(argv).toContain('--extension');
    });

    test('`pi <message>` (non-subcommand first arg) still gets injection', () => {
      const { argv } = runWrapper(['hello world'], { OUIJIT_API_URL: 'http://stub' });
      expect(argv).toContain('--append-system-prompt');
      expect(argv).toContain('--extension');
      expect(argv).toContain('hello world');
    });

    test('subcommand passthrough applies even when OUIJIT_API_URL is unset', () => {
      const { argv } = runWrapper(['update']);
      expect(argv).toEqual(['update']);
    });
  });
});

// ── PI_EXTENSION constant ────────────────────────────────────────────

describe('PI_EXTENSION', () => {
  test('is a TypeScript module with a default-export factory', () => {
    expect(PI_EXTENSION).toMatch(/export default async \(pi: \w+\) =>/);
  });

  test('subscribes agent_start → thinking and agent_end → ready exactly once each', () => {
    expect(PI_EXTENSION.match(/pi\.on\('agent_start'/g)).toHaveLength(1);
    expect(PI_EXTENSION.match(/pi\.on\('agent_end'/g)).toHaveLength(1);
    expect(PI_EXTENSION).not.toContain("pi.on('turn_end'");
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

  test('pings ready once per prompt regardless of turn count when the factory runs', async () => {
    // agent_* events fire once per prompt, so a multi-turn prompt should
    // still produce exactly one 'ready' ping.
    const handlers: Record<string, () => void> = {};
    const pings: string[] = [];
    const pi = {
      on: (event: string, handler: () => void) => {
        handlers[event] = handler;
      },
      exec: async (_cmd: string, args: string[]) => {
        pings.push(args[1].replace('status=', ''));
      },
    };
    const factory = loadDefaultExport<(pi: unknown) => Promise<void>>(PI_EXTENSION, {
      OUIJIT_HOOK_BIN: '/fake/ouijit-hook',
    });
    await factory(pi);

    // One prompt, three internal turns.
    handlers.agent_start();
    handlers.turn_start?.();
    handlers.turn_end?.();
    handlers.turn_start?.();
    handlers.turn_end?.();
    handlers.turn_start?.();
    handlers.turn_end?.();
    handlers.agent_end();

    expect(pings).toEqual(['thinking', 'ready']);
  });
});

function loadDefaultExport<T>(src: string, env: Record<string, string>): T {
  const transpiled = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module: { exports: { default?: T } } = { exports: {} };
  new Function('exports', 'module', 'require', 'process', transpiled)(
    module.exports,
    module,
    createRequire(import.meta.url),
    { env },
  );
  return module.exports.default!;
}

// ── OPENCODE_WRAPPER constant ────────────────────────────────────────

describe('OPENCODE_WRAPPER', () => {
  test('resolves real opencode and re-exports wrapper dir on PATH', () => {
    expect(OPENCODE_WRAPPER).toContain('WRAPPER_DIR=');
    expect(OPENCODE_WRAPPER).toContain('REAL_BIN=');
    expect(OPENCODE_WRAPPER).toContain('export PATH="$WRAPPER_DIR:$CLEAN_PATH"');
  });

  describe('launching opencode', () => {
    const runWrapper = (args: string[], version: string, env: Record<string, string> = {}) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-wrapper-test-'));
      const wrapperDir = path.join(root, 'wrapper');
      const stubDir = path.join(root, 'stub');
      fs.mkdirSync(wrapperDir);
      fs.mkdirSync(stubDir);
      const logFile = path.join(root, 'invoke.log');
      fs.writeFileSync(path.join(wrapperDir, 'opencode'), OPENCODE_WRAPPER, { mode: 0o755 });
      fs.writeFileSync(
        path.join(stubDir, 'opencode'),
        [
          '#!/bin/bash',
          'if [ "$1" = "--version" ]; then echo "$STUB_VERSION"; exit 0; fi',
          'if [ "$1" = session ] && [ "$2" = list ]; then',
          '  printf "%s\\n" "$OUIJIT_TEST_SESSION_LIST"',
          '  exit 0',
          'fi',
          `for a in "$@"; do printf 'ARGV:%s\\n' "$a" >> "${logFile}"; done`,
          `printf 'CFG:%s\\n' "$OPENCODE_CONFIG_CONTENT" >> "${logFile}"`,
          `printf 'HOOK:%s\\n' "$OUIJIT_HOOK_BIN" >> "${logFile}"`,
          `printf 'REF:%s\\n' "$OUIJIT_REFERENCE_FILE" >> "${logFile}"`,
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      try {
        execFileSync(path.join(wrapperDir, 'opencode'), args, {
          env: {
            PATH: `${wrapperDir}:${stubDir}:/usr/bin:/bin`,
            HOME: root,
            STUB_VERSION: version,
            OUIJIT_API_URL: 'http://stub',
            ...env,
          },
          encoding: 'utf8',
        });
        const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
        const value = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length) ?? '';
        const config = value('CFG:');
        return {
          argv: lines.filter((l) => l.startsWith('ARGV:')).map((l) => l.slice(5)),
          instructions: config ? (JSON.parse(config) as { instructions: string[] }).instructions : [],
          hook: value('HOOK:'),
          reference: value('REF:'),
        };
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    };

    const v1 = '1.18.35';
    const v2 = 'opencode v2.0.26';

    test('utility subcommands pass through untouched', () => {
      for (const version of [v1, v2]) {
        expect(runWrapper(['auth', 'login'], version)).toEqual({
          argv: ['auth', 'login'],
          instructions: [],
          hook: '',
          reference: '',
        });
      }
    });

    test('opencode 1 gets the CLI reference as config instructions and runs in place', () => {
      const session = runWrapper(['run', 'hello world'], v1);
      expect(session.argv).toEqual(['run', 'hello world']);
      expect(session.instructions).toEqual([expect.stringMatching(/\/\.config\/Ouijit\/ouijit-cli-reference\.md$/)]);
      expect(session.hook).toMatch(/\/\.config\/Ouijit\/bin\/ouijit-hook$/);
    });

    test('opencode 2 gets a private server, unless one is chosen explicitly', () => {
      const session = runWrapper([], v2);
      expect(session.argv).toEqual(['--standalone']);
      expect(session.reference).toMatch(/\/\.config\/Ouijit\/ouijit-cli-reference\.md$/);
      expect(session.hook).toMatch(/\/\.config\/Ouijit\/bin\/ouijit-hook$/);
      expect(runWrapper(['--continue', 'src'], v2).argv).toEqual(['--standalone', '--continue', 'src']);
      expect(runWrapper(['run', 'hello world'], v2).argv).toEqual(['run', '--standalone', 'hello world']);
      expect(runWrapper(['--server', 'http://host:4096'], v2).argv).toEqual(['--server', 'http://host:4096']);
      expect(runWrapper(['run', '--standalone', 'hi'], v2).argv).toEqual(['run', '--standalone', 'hi']);
    });

    test('continue resumes the newest session started in this worktree, never another worktree’s', () => {
      const sessions = JSON.stringify(
        [
          { id: 'ses_other', title: '"id": "ses_title"', directory: '/tmp/project/T-1' },
          { id: 'ses_sibling', title: 'a', directory: '/tmp/project/T-22' },
          { id: 'ses_task_new', title: 'b', directory: '/tmp/project/T-2/src' },
          { id: 'ses_task_old', title: 'c', directory: '/tmp/project/T-2' },
        ],
        null,
        2,
      );
      const inWorktree = (worktree: string, args: string[], version = v1) =>
        runWrapper(args, version, { OUIJIT_WORKTREE_PATH: worktree, OUIJIT_TEST_SESSION_LIST: sessions });

      const resumed = inWorktree('/tmp/project/T-2', ['-c', '--model', 'x']);
      expect(resumed.argv).toEqual(['--session', 'ses_task_new', '--model', 'x']);
      expect(resumed.instructions).toHaveLength(1);
      expect(resumed.hook).not.toBe('');

      expect(inWorktree('/tmp/project/T-2', ['run', '--continue', 'hi'], v2).argv).toEqual([
        'run',
        '--standalone',
        '--session',
        'ses_task_new',
        'hi',
      ]);
      expect(inWorktree('/tmp/project/T-3', ['-c']).argv).toEqual([]);
      expect(inWorktree('/tmp/project/T-2', ['-c', '--session', 'ses_explicit']).argv).toEqual([
        '-c',
        '--session',
        'ses_explicit',
      ]);
      expect(runWrapper(['-c'], v1, { OUIJIT_TEST_SESSION_LIST: sessions }).argv).toEqual(['-c']);
    });

    test('without OUIJIT_API_URL the CLI reference is still offered but status stays off', () => {
      for (const version of [v1, v2]) {
        const session = runWrapper([], version, { OUIJIT_API_URL: '' });
        expect(session.instructions).toHaveLength(1);
        expect(session.reference).not.toBe('');
        expect(session.hook).toBe('');
      }
    });
  });

  test('does not recurse into itself when PATH lists the wrapper dir twice (regression for T-407)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapper-resolver-opencode-'));
    try {
      const wrapperDir = path.join(tmp, 'wrapper-bin');
      const realDir = path.join(tmp, 'real-bin');
      fs.mkdirSync(wrapperDir);
      fs.mkdirSync(realDir);
      fs.writeFileSync(path.join(wrapperDir, 'opencode'), OPENCODE_WRAPPER, { mode: 0o755 });
      // Real-binary stand-in prints a sentinel and echoes the injected config.
      fs.writeFileSync(
        path.join(realDir, 'opencode'),
        '#!/bin/bash\necho REAL_BIN_OK\nprintf "CFG:%s\\n" "$OPENCODE_CONFIG_CONTENT"\nprintf "%s\\n" "$@"\n',
        { mode: 0o755 },
      );
      const wrapperDirSymlink = path.join(tmp, 'wrapper-bin-link');
      fs.symlinkSync(wrapperDir, wrapperDirSymlink);
      const fakePath = [wrapperDir, realDir, wrapperDirSymlink, '/usr/bin', '/bin'].join(':');

      const result = execFileSync('bash', [path.join(wrapperDir, 'opencode'), 'hello'], {
        env: { PATH: fakePath, HOME: tmp, OUIJIT_API_URL: '' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      expect(result).toContain('REAL_BIN_OK');
      expect(result).toContain('ouijit-cli-reference.md');
      expect(result).toContain('hello');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── OPENCODE_PLUGIN constant ─────────────────────────────────────────

describe('OPENCODE_PLUGIN', () => {
  let pingLog: string;
  let env: Record<string, string>;

  beforeEach(() => {
    pingLog = path.join(tmpHome, 'pings.log');
    const hookBin = path.join(tmpHome, 'ouijit-hook');
    fs.writeFileSync(hookBin, `#!/bin/bash\necho "$2" >> "${pingLog}"\n`, { mode: 0o755 });
    const referenceFile = path.join(tmpHome, 'reference.md');
    fs.writeFileSync(referenceFile, 'Use `ouijit task list`.');
    env = { OUIJIT_HOOK_BIN: hookBin, OUIJIT_REFERENCE_FILE: referenceFile };
  });

  const pings = () => (fs.existsSync(pingLog) ? fs.readFileSync(pingLog, 'utf8').split('\n').filter(Boolean) : []);
  const waitForPings = (count: number) => vi.waitFor(() => expect(pings()).toHaveLength(count));

  test('on opencode 2, adds the CLI reference to every request and reports each turn', async () => {
    const plugin = loadDefaultExport<OpencodePlugin>(OPENCODE_PLUGIN, env);
    const events = fakeEventSubscription();
    let contextHook: ((event: { system: { type: string; text: string }[] }) => void) | undefined;
    const cleanup = await plugin.setup({
      event: { subscribe: events.subscribe },
      session: {
        hook: async (_name, callback) => {
          contextHook = callback;
        },
      },
    });

    const request = { system: [{ type: 'text', text: 'You are opencode.' }] };
    contextHook!(request);
    expect(request.system[1]).toEqual({ type: 'text', text: 'Use `ouijit task list`.' });

    events.push({ type: 'session.execution.started', data: { sessionID: 'ses_parent' } });
    await waitForPings(1);
    events.push({ type: 'session.execution.started', data: { sessionID: 'ses_subagent' } });
    events.push({ type: 'session.text.delta', data: { sessionID: 'ses_parent' } });
    events.push({ type: 'session.execution.succeeded', data: { sessionID: 'ses_subagent' } });
    events.push({ type: 'session.execution.succeeded', data: { sessionID: 'ses_parent' } });
    await waitForPings(2);
    events.push({ type: 'session.execution.started', data: { sessionID: 'ses_parent' } });
    await waitForPings(3);
    events.push({ type: 'session.execution.interrupted', data: { sessionID: 'ses_parent' } });
    await waitForPings(4);
    expect(pings()).toEqual(['status=thinking', 'status=ready', 'status=thinking', 'status=ready']);

    cleanup!();
    expect(events.signal()?.aborted).toBe(true);
  });

  test('on opencode 1, maps session.status busy/idle to thinking/ready', async () => {
    const handlers = await loadDefaultExport<OpencodePlugin>(OPENCODE_PLUGIN, env).server();
    const status = (type: string) => ({ event: { type: 'session.status', properties: { status: { type } } } });

    await handlers.event!(status('busy'));
    await waitForPings(1);
    await handlers.event!(status('retry'));
    await handlers.event!({ event: { type: 'message.updated' } });
    await handlers.event!(status('idle'));
    await waitForPings(2);
    expect(pings()).toEqual(['status=thinking', 'status=ready']);
  });

  test('stays inert outside the wrapper', async () => {
    const plugin = loadDefaultExport<OpencodePlugin>(OPENCODE_PLUGIN, {});
    const subscribe = vi.fn();
    const hook = vi.fn();
    expect(await plugin.setup({ event: { subscribe }, session: { hook } })).toBeUndefined();
    expect(subscribe).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(await plugin.server()).toEqual({});
  });
});

type OpencodeEvent = { type: string; data?: { sessionID?: string }; properties?: { status?: { type?: string } } };

interface OpencodePlugin {
  id: string;
  setup(ctx: {
    event: { subscribe(options: { signal: AbortSignal }): AsyncIterable<OpencodeEvent> };
    session: {
      hook(name: 'context', callback: (event: { system: { type: string; text: string }[] }) => void): Promise<unknown>;
    };
  }): Promise<(() => void) | undefined>;
  server(): Promise<{ event?: (arg: { event: OpencodeEvent }) => Promise<void> }>;
}

function fakeEventSubscription() {
  const queue: OpencodeEvent[] = [];
  let wake: (() => void) | undefined;
  let subscribed: AbortSignal | undefined;
  return {
    push(event: OpencodeEvent) {
      queue.push(event);
      wake?.();
    },
    signal: () => subscribed,
    async *subscribe({ signal }: { signal: AbortSignal }): AsyncIterable<OpencodeEvent> {
      subscribed = signal;
      while (!signal.aborted) {
        const event = queue.shift();
        if (event) yield event;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}
