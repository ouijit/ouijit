import { isSandboxBackendId, type SandboxProviderId } from '../sandbox/types';

export const SANDBOX_FLAG_VALUES = 'host|nono|custom';

/** `host` is the CLI's word for the API's `none`. Null for anything else. */
export function parseSandboxFlag(value: string): SandboxProviderId | null {
  if (value === 'host') return 'none';
  return isSandboxBackendId(value) ? value : null;
}
