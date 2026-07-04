import { describe, test, expect } from 'vitest';
import { buildNonoLaunch, type NonoArgvContext } from '../sandbox/nono/argv';
import type { SandboxLaunch } from '../sandbox/types';

const launch: SandboxLaunch = { file: '/bin/zsh', args: ['-il'], env: { FOO: 'bar' } };

const baseCtx: NonoArgvContext = {
  worktreePath: '/Users/dev/Ouijit/worktrees/proj/T-5',
  mainGitDir: '/Users/dev/code/proj/.git',
  apiPort: 41234,
  wrapperDir: '/Users/dev/.config/Ouijit',
};

function build(ctx: Partial<NonoArgvContext> = {}) {
  return buildNonoLaunch('/opt/bin/nono', launch, { ...baseCtx, ...ctx });
}

describe('buildNonoLaunch', () => {
  test('wraps the shell launch as a supervised `nono run` under the union profile', () => {
    const { file, args, env } = build();
    expect(file).toBe('/opt/bin/nono');
    // run mode (supervisor: banner + denial prompts), the union profile, and the
    // startup-timeout disabled so a plain shell is not killed for never entering a TUI.
    expect(args.slice(0, 6)).toEqual(['run', '--profile', 'ouijit', '--startup-timeout', '0', '--allow-cwd']);
    expect(args).not.toContain('--silent');
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

  test('grants the Ouijit wrapper dir so the PATH-first agent shims execute', () => {
    const { args } = build();
    const readTargets = args.reduce<string[]>((acc, a, i) => (a === '--read' ? [...acc, args[i + 1]] : acc), []);
    expect(readTargets).toContain('/Users/dev/.config/Ouijit');
    // Global git config is not granted here — the union profile's git_config group covers it.
    expect(readTargets).not.toContain('/Users/dev/.config/git');
    expect(args).not.toContain('--read-file');
  });

  test('adds block-net when configured', () => {
    const { args } = build({ config: { blockNet: true } });
    expect(args).toContain('--block-net');
  });

  test('opens extra configured ports in addition to the hook port', () => {
    const { args } = build({ apiPort: 5000, config: { openPorts: [3000, 8080] } });
    const opened = args.reduce<string[]>((acc, a, i) => (a === '--open-port' ? [...acc, args[i + 1]] : acc), []);
    expect(opened).toEqual(['5000', '3000', '8080']);
  });

  test('grants extra configured folders read+write alongside the worktree', () => {
    const { args } = build({ config: { allowPaths: ['/Users/dev/cache', '/Users/dev/mono/sibling'] } });
    const allowed = args.reduce<string[]>((acc, a, i) => (a === '--allow' ? [...acc, args[i + 1]] : acc), []);
    // The worktree is always first; the configured extras follow.
    expect(allowed).toContain('/Users/dev/cache');
    expect(allowed).toContain('/Users/dev/mono/sibling');
    expect(allowed[0]).toBe('/Users/dev/Ouijit/worktrees/proj/T-5');
  });

  test('keeps paths with spaces as single argv elements', () => {
    const { args } = build({ worktreePath: '/Users/dev/My Projects/T-5' });
    expect(args).toContain('/Users/dev/My Projects/T-5');
  });
});
