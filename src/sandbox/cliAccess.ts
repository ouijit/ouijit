import { getGlobalSetting } from '../db';
import { isSandboxCliAccess, sandboxCliAccessSettingKey, type SandboxCliAccess } from './types';

/** How much of the Ouijit API a project's sandboxed terminals may use: read only until set. */
export async function sandboxCliAccessFor(projectPath: string): Promise<SandboxCliAccess> {
  const stored = await getGlobalSetting(sandboxCliAccessSettingKey(projectPath));
  return isSandboxCliAccess(stored) ? stored : 'read';
}
