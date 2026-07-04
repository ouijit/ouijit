import * as path from 'node:path';
import type { NonoConfig, SandboxLaunch } from '../types';
import { OUIJIT_PROFILE_NAME } from './profile';

/** Everything the argv builder needs, resolved at spawn time. */
export interface NonoArgvContext {
  /** The task worktree — granted read+write. */
  worktreePath: string;
  /** Absolute main-repo `.git` common dir (a linked worktree's real gitdir). */
  mainGitDir: string;
  /** Host hook-server port to keep reachable from inside the sandbox. */
  apiPort: number;
  /** Ouijit wrapper/CLI dir (`~/.config/Ouijit`) the agent hooks live in. */
  wrapperDir: string;
  /**
   * Dir holding the bundled `ouijit` CLI (`<app>/dist-cli`) the `ouijit`
   * wrapper `exec node`s. Outside the worktree, so it needs its own grant or
   * the CLI is unreadable and every `ouijit …` call dies. Empty when unresolved.
   */
  cliDir?: string;
  config?: NonoConfig;
}

/**
 * Build the `nono run` argv that sandboxes a host launch under Ouijit's union
 * profile. Pure (no fs / no process) so it is exhaustively unit-testable; the
 * provider passes the resolved binary path and spawn context.
 *
 * `run` (not `wrap`) so the supervisor is present: it prints the grant banner,
 * shows interactive denial prompts, and lets agents authenticate through the
 * keychain grant the profile carries. `--startup-timeout 0` disables the
 * alt-screen watchdog, which would otherwise kill a plain shell that never
 * enters a full-screen TUI.
 *
 * The profile carries the static, agent-facing grants (per-agent config dirs,
 * keychain, global git config, runtime groups). Layered on here are the
 * per-task grants that can't live in a static profile:
 *   - the task worktree, read+write
 *   - the main `.git` read-only, with objects/refs/logs/worktrees writable so
 *     commits land while hooks/config stay unwritable (mirrors Lima's mounts)
 *   - the Ouijit wrapper dir (its agent shims are first on PATH) and the
 *     hook-server port
 *
 * Network is nono's default (allowed) unless `config.blockNet` opts into deny,
 * in which case `--open-port` keeps the hook server reachable.
 */
export function buildNonoLaunch(nonoPath: string, launch: SandboxLaunch, ctx: NonoArgvContext): SandboxLaunch {
  const git = ctx.mainGitDir;
  const args: string[] = ['run', '--profile', OUIJIT_PROFILE_NAME, '--startup-timeout', '0', '--allow-cwd'];

  if (ctx.config?.blockNet) args.push('--block-net');

  // Always open the hook-server port: harmless when network is allowed,
  // essential when it is blocked (the agent-status pipeline depends on it).
  args.push('--open-port', String(ctx.apiPort));
  for (const port of ctx.config?.openPorts ?? []) {
    args.push('--open-port', String(port));
  }

  args.push('--allow', ctx.worktreePath);
  // Extra user-granted folders (read+write), e.g. a shared cache or a monorepo
  // sibling that lives outside the worktree.
  for (const extra of ctx.config?.allowPaths ?? []) {
    args.push('--allow', extra);
  }
  args.push('--read', git);
  args.push('--write', path.join(git, 'objects'));
  args.push('--write', path.join(git, 'refs'));
  args.push('--write', path.join(git, 'logs'));
  args.push('--write', path.join(git, 'worktrees'));

  // Ouijit wrapper scripts (first on PATH) and the bundled CLI they exec.
  args.push('--read', ctx.wrapperDir);
  if (ctx.cliDir) args.push('--read', ctx.cliDir);

  args.push('--', launch.file, ...launch.args);

  return { file: nonoPath, args, env: launch.env };
}
