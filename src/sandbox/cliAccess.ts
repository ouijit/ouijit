import { getGlobalSetting } from '../db';
import { getCliReferencePath } from '../cliReferencePath';
import { isSandboxCliAccess, sandboxCliAccessSettingKey, type SandboxBackendId, type SandboxCliAccess } from './types';

/** How much of the Ouijit API a project's sandboxed terminals may use: read only until set. */
export async function sandboxCliAccessFor(projectPath: string): Promise<SandboxCliAccess> {
  const stored = await getGlobalSetting(sandboxCliAccessSettingKey(projectPath));
  return isSandboxCliAccess(stored) ? stored : 'read';
}

/**
 * A sandboxed session reads the CLI reference written for its backend and the
 * project's CLI access level, so an agent is not told about commands the
 * sandbox will refuse.
 */
export async function sandboxReferenceEnv(
  provider: SandboxBackendId | undefined,
  projectPath: string,
): Promise<Record<string, string>> {
  if (!provider) return {};
  const access = await sandboxCliAccessFor(projectPath).catch((): SandboxCliAccess => 'read');
  return { OUIJIT_SANDBOX_REFERENCE_FILE: getCliReferencePath({ provider, access }) };
}
