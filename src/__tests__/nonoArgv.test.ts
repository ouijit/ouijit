import { describe, test, expect } from 'vitest';
import { buildNonoLaunch, type NonoArgvContext } from '../sandbox/nono/argv';
import type { SandboxLaunch } from '../sandbox/types';

const launch: SandboxLaunch = { file: '/bin/zsh', args: ['-il'], env: { FOO: 'bar' } };

const baseCtx: NonoArgvContext = {
  worktreePath: '/Users/dev/Ouijit/worktrees/proj/T-5',
  mainGitDir: '/Users/dev/code/proj/.git',
  apiPort: 41234,
  homeDir: '/Users/dev',
  wrapperDir: '/Users/dev/.config/Ouijit',
};

function build(ctx: Partial<NonoArgvContext> = {}) {
  return buildNonoLaunch('/opt/bin/nono', launch, { ...baseCtx, ...ctx });
}

describe('buildNonoLaunch', () => {
  test('wraps the shell launch as the tail of a `nono wrap` argv', () => {
    const { file, args, env } = build();
    expect(file).toBe('/opt/bin/nono');
    expect(args.slice(0, 3)).toEqual(['wrap', '--silent', '--allow-cwd']);
    // The original launch is preserved verbatim after the `--` separator.
    const sep = args.indexOf('--');
    expect(sep).toBeGreaterThan(0);
    expect(args.slice(sep)).toEqual(['--', '/bin/zsh', '-il']);
    // Env passes through untouched (nono inherits it).
    expect(env).toBe(launch.env);
  });

  test('grants the worktree read+write', () => {
    const { args } = build();
    expect(args).toContain('--allow');
    expect(args[args.indexOf('--allow') + 1]).toBe('/Users/dev/Ouijit/worktrees/proj/T-5');
  });

  test('grants the MAIN repo .git read-only with the writable overlay subdirs', () => {
    const { args } = build();
    // Read-only base is the main common dir, not the worktree's .git file.
    expect(args[args.indexOf('--read') + 1]).toBe('/Users/dev/code/proj/.git');
    // The four writable overlays needed for commits, under the main .git.
    const writeTargets = args.reduce<string[]>((acc, a, i) => {
      if (a === '--write') acc.push(args[i + 1]);
      return acc;
    }, []);
    expect(writeTargets).toEqual([
      '/Users/dev/code/proj/.git/objects',
      '/Users/dev/code/proj/.git/refs',
      '/Users/dev/code/proj/.git/logs',
      '/Users/dev/code/proj/.git/worktrees',
    ]);
    // .git/config and .git/hooks are never writable (host-RCE class).
    expect(writeTargets).not.toContain('/Users/dev/code/proj/.git/config');
    expect(writeTargets).not.toContain('/Users/dev/code/proj/.git/hooks');
  });

  test('always opens the hook-server port', () => {
    const { args } = build();
    const openPortIdxs = args.reduce<number[]>((acc, a, i) => (a === '--open-port' ? [...acc, i] : acc), []);
    expect(openPortIdxs.length).toBeGreaterThanOrEqual(1);
    expect(args[openPortIdxs[0] + 1]).toBe('41234');
  });

  test('grants global git config and the Ouijit wrapper dir', () => {
    const { args } = build();
    const readTargets = args.reduce<string[]>((acc, a, i) => (a === '--read' ? [...acc, args[i + 1]] : acc), []);
    const readFileTargets = args.reduce<string[]>(
      (acc, a, i) => (a === '--read-file' ? [...acc, args[i + 1]] : acc),
      [],
    );
    expect(readFileTargets).toContain('/Users/dev/.gitconfig');
    expect(readTargets).toContain('/Users/dev/.config/git');
    expect(readTargets).toContain('/Users/dev/.config/Ouijit');
  });

  test('appends a profile and block-net when configured', () => {
    const { args } = build({ config: { profile: 'always-further/claude', blockNet: true } });
    expect(args).toContain('--profile');
    expect(args[args.indexOf('--profile') + 1]).toBe('always-further/claude');
    expect(args).toContain('--block-net');
  });

  test('opens extra configured ports in addition to the hook port', () => {
    const { args } = build({ apiPort: 5000, config: { openPorts: [3000, 8080] } });
    const opened = args.reduce<string[]>((acc, a, i) => (a === '--open-port' ? [...acc, args[i + 1]] : acc), []);
    expect(opened).toEqual(['5000', '3000', '8080']);
  });

  test('keeps paths with spaces as single argv elements', () => {
    const { args } = build({ worktreePath: '/Users/dev/My Projects/T-5' });
    expect(args).toContain('/Users/dev/My Projects/T-5');
  });
});
