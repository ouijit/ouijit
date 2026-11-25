import { getGlobalSetting } from '../db';
import {
  SANDBOXABLE_HOOK_TYPES,
  defaultSandboxSettingKey,
  isActiveSandbox,
  isSandboxProviderId,
  type SandboxPlacement,
  type SandboxSpec,
} from './types';

export interface SandboxRequest {
  projectPath: string;
  /** Absent is the project's default. */
  placement?: SandboxPlacement;
  /** The spec of the sandboxed caller asking, which what it starts takes over any placement. */
  caller?: SandboxSpec | null;
  /** The hook it runs, if any. */
  hookType?: string | null;
}

/** Where a session runs. Every session the main process starts gets its sandbox from here. */
export async function resolveSandbox({
  projectPath,
  placement,
  caller,
  hookType,
}: SandboxRequest): Promise<SandboxSpec | null> {
  // A hook that cannot run sandboxed goes to the host, where a sandboxed caller's waits for the user.
  if (hookType && !SANDBOXABLE_HOOK_TYPES.includes(hookType)) return null;
  if (caller) return caller;
  if (typeof placement === 'object') return placement;
  const provider = placement ?? (await getGlobalSetting(defaultSandboxSettingKey(projectPath)));
  return isSandboxProviderId(provider) && isActiveSandbox(provider) ? { provider, settings: projectPath } : null;
}
