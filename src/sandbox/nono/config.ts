import { getGlobalSetting, setGlobalSetting } from '../../db';
import type { NonoProfile } from '../types';
import { ensureProjectProfile } from './profile';

/** Global-settings key holding a profile file the project uses in place of its own. */
function chosenProfileKey(projectPath: string): string {
  return `nonoProfile:${projectPath}`;
}

export async function getNonoProfile(projectPath: string): Promise<NonoProfile> {
  const chosen = await getGlobalSetting(chosenProfileKey(projectPath));
  if (chosen) return { path: chosen, own: false };
  return { path: await ensureProjectProfile(projectPath), own: true };
}

/** Null goes back to the project's own profile. */
export async function setNonoProfile(projectPath: string, file: string | null): Promise<NonoProfile> {
  await setGlobalSetting(chosenProfileKey(projectPath), file ?? '');
  return getNonoProfile(projectPath);
}
