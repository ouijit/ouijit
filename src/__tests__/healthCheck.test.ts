import { describe, test, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.fn();
const isLimaInstalledMock = vi.fn();
const isNonoInstalledMock = vi.fn();

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

vi.mock('../sandbox/nono/binary', () => ({
  isNonoInstalled: () => isNonoInstalledMock(),
}));

type ExecFileCallback = (err: Error | null, stdout?: string, stderr?: string) => void;

/**
 * What the gh fields look like when `gh` is not on PATH. Every case below whose
 * execFile mock rejects unknown commands lands here, so spelling it once keeps
 * the assertions about the tool each test actually cares about.
 */
const GH_ABSENT = {
  gh: false,
  ghVersionOk: false,
  ghVersion: undefined,
} as const;

describe('healthCheck', () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    isLimaInstalledMock.mockReset();
    isNonoInstalledMock.mockReset();
    // Default nono to false; individual tests override as needed.
    isNonoInstalledMock.mockResolvedValue(false);
  });

  test('reports all tools present and parses git version', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: ExecFileCallback) => {
      if (cmd === 'git') cb(null, 'git version 2.39.5\n', '');
      else if (cmd === 'which') cb(null, `/usr/local/bin/${args[0]}\n`, '');
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(true);
    isNonoInstalledMock.mockResolvedValue(true);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status).toEqual({
      git: true,
      claude: true,
      codex: true,
      pi: true,
      opencode: true,
      lima: true,
      nono: true,
      gitVersion: '2.39.5',
      ...GH_ABSENT,
    });
  });

  test('reports git missing when execFile rejects', async () => {
    execFileMock.mockImplementation((cmd: string, _args: string[], cb: ExecFileCallback) => {
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
      nono: false,
      gitVersion: undefined,
      ...GH_ABSENT,
    });
  });

  test('detects codex independently of claude', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: ExecFileCallback) => {
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
      nono: false,
      gitVersion: '2.41.0',
      ...GH_ABSENT,
    });
  });

  test('detects pi independently of claude and codex', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: ExecFileCallback) => {
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
      nono: false,
      gitVersion: '2.42.0',
      ...GH_ABSENT,
    });
  });

  test('detects opencode independently of the other agents', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: ExecFileCallback) => {
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
      nono: false,
      gitVersion: '2.43.0',
      ...GH_ABSENT,
    });
  });

  test('caches result and exposes via getCachedHealth', async () => {
    execFileMock.mockImplementation((cmd: string, _args: string[], cb: ExecFileCallback) => {
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
      nono: false,
      gitVersion: '2.40.0',
      ...GH_ABSENT,
    });
  });

  test('detects gh without contacting GitHub', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: ExecFileCallback) => {
      if (cmd === 'git') cb(null, 'git version 2.45.0\n', '');
      else if (cmd === 'gh' && args[0] === '--version') cb(null, 'gh version 2.85.0 (2026-01-14)\n', '');
      else if (cmd === 'which') cb(new Error('not found'));
      else cb(new Error(`unexpected ${cmd} ${args.join(' ')}`));
    });
    isLimaInstalledMock.mockResolvedValue(false);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status.gh).toBe(true);
    expect(status.ghVersion).toBe('2.85.0');
    expect(status.ghVersionOk).toBe(true);
    // `gh auth status` validates the token over the network. Every other probe
    // here is a local binary check, and an offline machine would wait out its
    // timeout before the renderer learned anything about git or the agents.
    expect(execFileMock.mock.calls.some((call) => call[1]?.[0] === 'auth')).toBe(false);
  });

  test('flags a gh below the version floor as unusable rather than merely present', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], cb: ExecFileCallback) => {
      if (cmd === 'git') cb(null, 'git version 2.45.0\n', '');
      else if (cmd === 'gh' && args[0] === '--version') cb(null, 'gh version 2.4.0 (2021-01-01)\n', '');
      else if (cmd === 'which') cb(new Error('not found'));
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(false);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status.gh).toBe(true);
    expect(status.ghVersion).toBe('2.4.0');
    expect(status.ghVersionOk).toBe(false);
  });

  test('detects nono independently of lima', async () => {
    execFileMock.mockImplementation((cmd: string, _args: string[], cb: ExecFileCallback) => {
      if (cmd === 'git') cb(null, 'git version 2.44.0\n', '');
      else if (cmd === 'which') cb(new Error('not found'));
      else cb(new Error(`unexpected ${cmd}`));
    });
    isLimaInstalledMock.mockResolvedValue(false);
    isNonoInstalledMock.mockResolvedValue(true);

    const { checkHealth } = await import('../healthCheck');
    const status = await checkHealth();
    expect(status.lima).toBe(false);
    expect(status.nono).toBe(true);
  });

  test('agents are looked for past our own wrappers', async () => {
    // `which codex` finds ~/.config/Ouijit/bin/codex whether or not codex is
    // installed — that file is ours. Probing through it reports four agents on
    // a machine with none, and the lens then picks one and dies at the spawn.
    const { withoutWrapperDir } = await import('../healthCheck');
    const wrapper = '/home/me/.config/Ouijit/bin';

    expect(withoutWrapperDir(`/usr/bin:${wrapper}:/usr/local/bin`, wrapper)).toBe('/usr/bin:/usr/local/bin');
    // Same directory, spelled differently.
    expect(withoutWrapperDir(`${wrapper}/:/usr/bin`, wrapper)).toBe('/usr/bin');
    // Nothing of ours on it: left exactly as it was.
    expect(withoutWrapperDir('/usr/bin:/bin', wrapper)).toBe('/usr/bin:/bin');
  });
});
