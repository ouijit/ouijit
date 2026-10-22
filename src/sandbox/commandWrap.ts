import type { BrowserWindow } from 'electron';
import { issueCommandToken, revokeCommandToken } from '../apiAuth';
import { getApiPort } from '../hookServer';
import { typedPush } from '../ipc/helpers';
import { getPtySpawnContext } from '../ptyManager';
import { getSandboxProvider } from './registry';
import type { SandboxBackendId, SandboxLaunch } from './types';

export interface WrappedCommand extends SandboxLaunch {
  cwd: string;
  /** The command's own sandbox-scoped API token; handing it back ends the run. */
  token: string;
}

/**
 * Wraps one command from a host terminal in a sandbox, with the grants that
 * terminal's task would get. The caller runs the result and must not pass it
 * the terminal's own token: that one is host-scoped.
 */
export async function wrapCommand(
  window: BrowserWindow,
  ptyId: string,
  backend: SandboxBackendId,
  argv: string[],
  cwd: string,
): Promise<WrappedCommand> {
  const context = getPtySpawnContext(ptyId);
  if (!context) throw new Error('This terminal is not one Ouijit is running');
  const provider = getSandboxProvider(backend);
  if (!provider) throw new Error(`No sandbox called ${backend}`);
  const [file, ...args] = argv;

  const spawn = {
    projectPath: context.projectPath,
    taskId: context.taskId,
    worktreePath: context.worktreePath,
    apiPort: getApiPort(),
  };
  const prepared = await provider.prepare({ ...spawn, cwd });
  const token = issueCommandToken(ptyId);
  const env = { ...prepared.env, OUIJIT_API_TOKEN: token };
  const wrapped = await provider.wrapLaunch({ file, args, env }, { ...spawn, cwd: prepared.cwd });
  typedPush(window, 'terminal-sandbox', { ptyId, sandboxProvider: backend });
  return { ...wrapped, cwd: prepared.cwd, token };
}

export function releaseCommand(window: BrowserWindow, ptyId: string, token: string): void {
  if (!revokeCommandToken(ptyId, token)) return;
  typedPush(window, 'terminal-sandbox', { ptyId, sandboxProvider: getPtySpawnContext(ptyId)?.sandboxProvider });
}
