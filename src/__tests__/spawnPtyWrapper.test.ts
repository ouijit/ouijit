import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { WrapperSandboxProvider } from '../sandbox/provider';

import * as apiAuth from '../apiAuth';
import { spawnPty, getActiveSessions } from '../ptyManager';

// Fake node-pty so no real process is spawned; capture spawn args and the
// data/exit listeners so a test can play a launcher's output back.
type DataCb = (data: string) => void;
type ExitCb = (e: { exitCode: number }) => void;
const fake = { onData: null as DataCb | null, onExit: null as ExitCb | null };
const ptySpawn = vi.fn(() => ({
  pid: 4242,
  onData: (cb: DataCb) => {
    fake.onData = cb;
  },
  onExit: (cb: ExitCb) => {
    fake.onExit = cb;
  },
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}));
vi.mock('node-pty', () => ({ spawn: (...a: unknown[]) => ptySpawn(...(a as [])) }));

// Deterministic shell-integration recipe so we can assert exact file/args.
const integrated = { value: true };
vi.mock('../shellIntegration', () => ({
  getShellIntegrationDir: () => '/si',
  resolveShellIntegration: () => ({
    id: 'zsh',
    isIntegrated: integrated.value,
    launch: () => ({ file: '/bin/zsh', args: ['-il'], env: {} }),
  }),
}));

const send = vi.fn();
const window = { isDestroyed: () => false, webContents: { send } } as unknown as Electron.BrowserWindow;

// A stand-in wrapper provider that prefixes an argv, exactly as nono will.
const fakeWrapper: WrapperSandboxProvider = {
  kind: 'wrapper',
  id: 'nono',
  displayName: 'nono',
  capabilities: { vmLifecycle: false, yamlConfig: false, sandboxView: false, profiles: true, network: true },
  isAvailable: async () => true,
  getStatus: async () => ({ providerId: 'nono', available: true, ready: true }),
  cleanup: vi.fn(),
  prepare: vi.fn(async (ctx) => ({ cwd: ctx.cwd })),
  wrapLaunch: vi.fn((launch, ctx) => ({
    file: '/usr/local/bin/nono',
    args: ['wrap', '--open-port', String(ctx.apiPort), '--', launch.file, ...launch.args],
    env: launch.env,
  })),
};

const launchFailures = () => send.mock.calls.filter((c) => c[0] === 'sandbox-launch-failed');

beforeEach(() => {
  vi.clearAllMocks();
  fake.onData = null;
  fake.onExit = null;
  integrated.value = true;
});

describe('spawnPty wrapper seam', () => {
  test('no wrapper: spawns the shell directly with a host-scoped token', async () => {
    const issue = vi.spyOn(apiAuth, 'issueToken');
    const result = await spawnPty({ cwd: '/proj', projectPath: '/proj' }, window);
    expect(result.success).toBe(true);

    const [file, args] = ptySpawn.mock.calls[0] as [string, string[]];
    expect(file).toBe('/bin/zsh');
    expect(args).toEqual(['-il']);
    expect(issue).toHaveBeenCalledWith(expect.any(String), 'host');

    // A plain shell exiting non-zero is not a launch failure.
    fake.onExit!({ exitCode: 1 });
    expect(launchFailures()).toHaveLength(0);
  });

  test('wrapper: prepare + wrapLaunch run, wrapped argv reaches node-pty, token is sandbox-scoped', async () => {
    const issue = vi.spyOn(apiAuth, 'issueToken');
    const result = await spawnPty(
      { cwd: '/proj', projectPath: '/proj', taskId: 3, sandboxProvider: 'nono' },
      window,
      fakeWrapper,
    );
    expect(result.success).toBe(true);
    expect(fakeWrapper.prepare).toHaveBeenCalledTimes(1);
    expect(fakeWrapper.wrapLaunch).toHaveBeenCalledTimes(1);

    // The shell launch is now the tail of the nono argv, not the spawned file.
    const [file, args] = ptySpawn.mock.calls[0] as [string, string[]];
    expect(file).toBe('/usr/local/bin/nono');
    expect(args.slice(0, 2)).toEqual(['wrap', '--open-port']);
    expect(args.slice(-2)).toEqual(['/bin/zsh', '-il']);

    // Sandbox-hosted shells get the restricted token scope.
    expect(issue).toHaveBeenCalledWith(expect.any(String), 'sandbox');

    // The active session records which backend runs it.
    const session = getActiveSessions().find((s) => s.ptyId === result.ptyId);
    expect(session?.sandboxProvider).toBe('nono');

    // nono is launch-watched like any wrapper: a refusal before the prompt is reported.
    fake.onExit!({ exitCode: 2 });
    expect(launchFailures()).toHaveLength(1);
    expect(launchFailures()[0][1]).toMatchObject({ provider: 'nono', exitCode: 2 });
  });

  test('wrapper that refuses in prepare fails the spawn and revokes the token it was issued', async () => {
    const issue = vi.spyOn(apiAuth, 'issueToken');
    const refusing: WrapperSandboxProvider = {
      ...fakeWrapper,
      id: 'custom',
      prepare: vi.fn(async () => {
        throw new Error('No sandbox command configured');
      }),
    };
    const result = await spawnPty({ cwd: '/proj', projectPath: '/proj', sandboxProvider: 'custom' }, window, refusing);
    expect(result).toEqual({ success: false, error: 'No sandbox command configured' });
    expect(ptySpawn).not.toHaveBeenCalled();
    const token = issue.mock.results[0].value as string;
    expect(apiAuth.verifyToken(token)).toBeNull();
  });

  test('launcher exiting non-zero before the shell starts is reported as a launch failure', async () => {
    await spawnPty({ cwd: '/proj', projectPath: '/proj', sandboxProvider: 'custom' }, window, {
      ...fakeWrapper,
      id: 'custom',
    });
    fake.onData!('\x1b[31mpolicy differs from trunk\x1b[0m\r\n');
    fake.onExit!({ exitCode: 2 });

    expect(send).toHaveBeenCalledWith(expect.stringMatching(/^pty:exit:/), 2);
    expect(launchFailures()).toHaveLength(1);
    expect(launchFailures()[0][1]).toEqual({
      ptyId: expect.any(String),
      provider: 'custom',
      exitCode: 2,
    });
  });

  test('once the shell has signalled a prompt, a non-zero exit is a plain exit', async () => {
    await spawnPty({ cwd: '/proj', projectPath: '/proj', sandboxProvider: 'custom' }, window, {
      ...fakeWrapper,
      id: 'custom',
    });
    fake.onData!('banner\r\n\x1b]');
    fake.onData!('13');
    fake.onData!('3;A\x07$ ');
    fake.onExit!({ exitCode: 1 });
    expect(launchFailures()).toHaveLength(0);
  });

  test('a shell without integration never signals, so it is not watched', async () => {
    integrated.value = false;
    await spawnPty({ cwd: '/proj', projectPath: '/proj', sandboxProvider: 'custom' }, window, {
      ...fakeWrapper,
      id: 'custom',
    });
    fake.onExit!({ exitCode: 3 });
    expect(launchFailures()).toHaveLength(0);
  });
});
