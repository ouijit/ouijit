import { getApiPort } from './apiPort';
import { getWrapperBinDir, getUserDataPath, getCliPath } from './paths';
import { getShellIntegrationDir } from './shellIntegration';
import { getVendoredNonoPath } from './sandbox/nono/binary';
import { getSandboxProvider } from './sandbox/registry';
import type { SandboxBackendId, SandboxLaunch, SandboxSpec } from './sandbox/types';

/** `process.env` without its undefined values, which node-pty and child_process both reject. */
export function hostEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * The OUIJIT_* contract every session process gets, terminal or chat agent:
 * its id and API token, so the `ouijit` CLI and agent hooks inside it reach the
 * hook server as that session, and the wrapper dir first on PATH.
 */
export function ouijitSessionEnv(
  sessionId: string,
  token: string,
  base: Record<string, string>,
): Record<string, string> {
  const wrapperBinDir = getWrapperBinDir();
  const env: Record<string, string> = {
    OUIJIT_SESSION_ID: sessionId,
    OUIJIT_API_URL: `http://127.0.0.1:${getApiPort()}`,
    OUIJIT_API_TOKEN: token,
    OUIJIT_WRAPPER_DIR: wrapperBinDir,
    OUIJIT_SHELL_INTEGRATION_DIR: getShellIntegrationDir(),
    PATH: `${wrapperBinDir}:${base['PATH'] || ''}`,
    OUIJIT_USER_DATA: getUserDataPath(),
  };
  const cliPath = getCliPath();
  if (cliPath) env['OUIJIT_CLI_PATH'] = cliPath;
  // nono's persistent-grant flow ends with `nono profile promote` run outside
  // the sandbox, in an ordinary session, so every session needs the shim
  // pointed at the vendored binary — not only sandboxed ones.
  const vendoredNono = getVendoredNonoPath();
  if (vendoredNono) env['OUIJIT_NONO_PATH'] = vendoredNono;
  return env;
}

export interface SandboxTarget {
  sandbox: SandboxSpec | null | undefined;
  projectPath: string;
  cwd: string;
  taskId?: number;
  worktreePath?: string;
  readPaths?: string[];
}

export class SandboxLaunchError extends Error {
  constructor(
    readonly provider: SandboxBackendId,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Run a host launch through the target's sandbox backend, or return it as is on
 * the host. The launch's env must already be complete: a backend may read it
 * (nono passes it through) but never adds the OUIJIT_* contract itself.
 */
export async function sandboxLaunch(
  launch: SandboxLaunch,
  target: SandboxTarget,
): Promise<{ launch: SandboxLaunch; cwd: string }> {
  const provider = getSandboxProvider(target.sandbox?.provider);
  if (!provider || !target.sandbox) return { launch, cwd: target.cwd };
  const context = {
    projectPath: target.projectPath,
    taskId: target.taskId,
    worktreePath: target.worktreePath,
    apiPort: getApiPort(),
    readPaths: target.readPaths,
    settings: target.sandbox.settings,
  };
  try {
    const prepared = await provider.prepare({ ...context, cwd: target.cwd });
    const env = prepared.env ? { ...launch.env, ...prepared.env } : launch.env;
    const wrapped = await provider.wrapLaunch({ ...launch, env }, { ...context, cwd: prepared.cwd });
    return { launch: { ...wrapped, env }, cwd: prepared.cwd };
  } catch (error) {
    throw new SandboxLaunchError(provider.id, error instanceof Error ? error.message : String(error));
  }
}
