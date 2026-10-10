import { SANDBOX_BACKEND_IDS, isSandboxBackendId, type SandboxProviderId } from '../sandbox/types';

const SANDBOX_FLAG_VALUES = ['host', ...SANDBOX_BACKEND_IDS].join('|');

/** `host` is the CLI's word for the API's `none`. An absent flag parses to no sandbox. */
export function parseSandboxFlag(value: string | undefined): { sandbox?: SandboxProviderId } | { error: string } {
  if (value === undefined) return {};
  if (value === 'host') return { sandbox: 'none' };
  if (isSandboxBackendId(value)) return { sandbox: value };
  return { error: `Invalid --sandbox: ${value}. Must be one of: ${SANDBOX_FLAG_VALUES}` };
}

export const SANDBOX_FLAG = '--sandbox <backend>';

export function sandboxFlagHelp(description: string): string {
  return `${description} (${SANDBOX_FLAG_VALUES})`;
}
