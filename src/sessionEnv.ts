import { getApiPort, getCliReferencePath } from './hookServer';
import { sandboxCliAccessFor } from './sandbox/cliAccess';
import { getWrapperBinDir, getUserDataPath, getCliPath } from './paths';
import { getShellIntegrationDir } from './shellIntegration';
import { getVendoredNonoPath } from './sandbox/nono/binary';
import type { SandboxProvider } from './sandbox/provider';
import type { SandboxBackendId, SandboxCliAccess, SandboxLaunch } from './sandbox/types';

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
    OUIJIT_PTY_ID: sessionId,
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

/**
 * A sandboxed session reads the CLI reference written for its backend and the
 * project's CLI access level, so an agent is not told about commands the
 * sandbox will refuse.
 */
export async function sandboxReferenceEnv(
  provider: SandboxBackendId | undefined,
  projectPath: string,
  access?: SandboxCliAccess,
): Promise<Record<string, string>> {
  if (!provider) return {};
  access ??= await sandboxCliAccessFor(projectPath).catch((): 'read' => 'read');
  return { OUIJIT_SANDBOX_REFERENCE_FILE: getCliReferencePath({ provider, access }) };
}

export interface SandboxTarget {
  provider: SandboxProvider | undefined;
  projectPath: string;
  cwd: string;
  taskId?: number;
  worktreePath?: string;
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
  const provider = target.provider;
  if (!provider) return { launch, cwd: target.cwd };
  const context = {
    projectPath: target.projectPath,
    taskId: target.taskId,
    worktreePath: target.worktreePath,
    apiPort: getApiPort(),
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
