import * as path from 'node:path';
import type { NonoConfig, SandboxLaunch } from '../types';

/** Everything the argv builder needs, resolved at spawn time. */
export interface NonoArgvContext {
  /** The task worktree — granted read+write. */
  worktreePath: string;
  /** Absolute main-repo `.git` common dir (a linked worktree's real gitdir). */
  mainGitDir: string;
  /** Host hook-server port to keep reachable from inside the sandbox. */
  apiPort: number;
  /** User home dir, for global git config grants. */
  homeDir: string;
  /** Ouijit wrapper/CLI dir (`~/.config/Ouijit`) the agent hooks live in. */
  wrapperDir: string;
  config?: NonoConfig;
}

/**
 * Build the `nono wrap` argv that sandboxes a host launch. Pure (no fs / no
 * process) so it is exhaustively unit-testable; the provider passes the
 * resolved binary path and spawn context.
 *
 * Grants (deny-by-default on macOS Seatbelt / Linux Landlock):
 *   - the task worktree, read+write
 *   - the main `.git` read-only, with objects/refs/logs/worktrees writable so
 *     commits land while hooks/config stay unwritable (mirrors Lima's mounts)
 *   - global git config, the Ouijit wrapper dir, and the hook-server port
 *
 * Network is nono's default (allowed) unless `config.blockNet` opts into deny,
 * in which case `--open-port` keeps the hook server reachable.
 */
export function buildNonoLaunch(nonoPath: string, launch: SandboxLaunch, ctx: NonoArgvContext): SandboxLaunch {
  const git = ctx.mainGitDir;
  const args: string[] = ['wrap', '--silent', '--allow-cwd'];

  if (ctx.config?.profile) args.push('--profile', ctx.config.profile);
  if (ctx.config?.blockNet) args.push('--block-net');

  // Always open the hook-server port: harmless when network is allowed,
  // essential when it is blocked (the agent-status pipeline depends on it).
  args.push('--open-port', String(ctx.apiPort));
  for (const port of ctx.config?.openPorts ?? []) {
    args.push('--open-port', String(port));
  }

  args.push('--allow', ctx.worktreePath);
  args.push('--read', git);
  args.push('--write', path.join(git, 'objects'));
  args.push('--write', path.join(git, 'refs'));
  args.push('--write', path.join(git, 'logs'));
  args.push('--write', path.join(git, 'worktrees'));

  // Global git config (nono tolerates paths that don't exist).
  args.push('--read-file', path.join(ctx.homeDir, '.gitconfig'));
  args.push('--read', path.join(ctx.homeDir, '.config', 'git'));
  // Ouijit wrapper scripts + CLI reference the agent hooks invoke.
  args.push('--read', ctx.wrapperDir);

  args.push('--', launch.file, ...launch.args);

  return { file: nonoPath, args, env: launch.env };
}
