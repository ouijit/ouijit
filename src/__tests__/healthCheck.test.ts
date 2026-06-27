import { describe, test, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.fn();
const isLimaInstalledMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: (_fn: unknown) => {
      return (cmd: string, args: string[]) => {
        return new Promise((resolve, reject) => {
          execFileMock(cmd, args, (err: Error | null, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          });
        });
      };
    },
  };
});

vi.mock('../lima/manager', () => ({
  isLimaInstalled: () => isLimaInstalledMock(),
}));

describe('healthCheck', () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    isLimaInstalledMock.mockReset();
  });

  test('reports all tools present and parses git version', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: Function) => {
      if (cmd === 'git') cb(null, 'git version 2.39.5\n', '');
      else if (cmd === 'which') cb(null, `/usr/local/bin/${args[0]}\n`, '');
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(true);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status).toEqual({
      git: true,
      claude: true,
      codex: true,
      pi: true,
      opencode: true,
      lima: true,
      gitVersion: '2.39.5',
    });
  });

  test('reports git missing when execFile rejects', async () => {
    execFileMock.mockImplementation((cmd: string, _args: string[], cb: Function) => {
      if (cmd === 'git') cb(new Error('command not found'));
      else if (cmd === 'which') cb(new Error('command not found'));
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(false);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status).toEqual({
      git: false,
      claude: false,
      codex: false,
      pi: false,
      opencode: false,
      lima: false,
      gitVersion: undefined,
    });
  });

  test('detects codex independently of claude', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: Function) => {
      if (cmd === 'git') cb(null, 'git version 2.41.0\n', '');
      else if (cmd === 'which' && args[0] === 'codex') cb(null, '/opt/homebrew/bin/codex\n', '');
      else if (cmd === 'which') cb(new Error('not found'));
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(false);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status).toEqual({
      git: true,
      claude: false,
      codex: true,
      pi: false,
      opencode: false,
      lima: false,
      gitVersion: '2.41.0',
    });
  });

  test('detects pi independently of claude and codex', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: Function) => {
      if (cmd === 'git') cb(null, 'git version 2.42.0\n', '');
      else if (cmd === 'which' && args[0] === 'pi') cb(null, '/opt/homebrew/bin/pi\n', '');
      else if (cmd === 'which') cb(new Error('not found'));
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(false);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status).toEqual({
      git: true,
      claude: false,
      codex: false,
      pi: true,
      opencode: false,
      lima: false,
      gitVersion: '2.42.0',
    });
  });

  test('detects opencode independently of the other agents', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: Function) => {
      if (cmd === 'git') cb(null, 'git version 2.43.0\n', '');
      else if (cmd === 'which' && args[0] === 'opencode') cb(null, '/opt/homebrew/bin/opencode\n', '');
      else if (cmd === 'which') cb(new Error('not found'));
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(false);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status).toEqual({
      git: true,
      claude: false,
      codex: false,
      pi: false,
      opencode: true,
      lima: false,
      gitVersion: '2.43.0',
    });
  });

  test('caches result and exposes via getCachedHealth', async () => {
    execFileMock.mockImplementation((cmd: string, _args: string[], cb: Function) => {
      if (cmd === 'git') cb(null, 'git version 2.40.0\n', '');
      else if (cmd === 'which') cb(new Error('not found'));
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(true);

    const { checkHealth, getCachedHealth } = await import('../healthCheck');
    expect(getCachedHealth()).toBeNull();
    await checkHealth();
    expect(getCachedHealth()).toEqual({
      git: true,
      claude: false,
      codex: false,
      pi: false,
      opencode: false,
      lima: true,
      gitVersion: '2.40.0',
    });
  });
});
