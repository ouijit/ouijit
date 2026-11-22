import { getGlobalSetting } from '../db';
import { getCliReferencePath } from '../cliReferencePath';
import { isSandboxCliAccess, sandboxCliAccessSettingKey, type SandboxCliAccess, type SandboxSpec } from './types';

/** How much of the Ouijit API sandboxes under these settings may use: read only until set. */
export async function sandboxCliAccessFor(settings: string): Promise<SandboxCliAccess> {
  const stored = await getGlobalSetting(sandboxCliAccessSettingKey(settings));
  return isSandboxCliAccess(stored) ? stored : 'read';
}

/**
 * A sandboxed session reads the CLI reference written for its backend and the
 * CLI access level of its sandbox settings, so an agent is not told about
 * commands the sandbox will refuse.
 */
export async function sandboxReferenceEnv(sandbox: SandboxSpec | null | undefined): Promise<Record<string, string>> {
  if (!sandbox) return {};
  const access = await sandboxCliAccessFor(sandbox.settings).catch((): SandboxCliAccess => 'read');
  return { OUIJIT_SANDBOX_REFERENCE_FILE: getCliReferencePath({ provider: sandbox.provider, access }) };
}
