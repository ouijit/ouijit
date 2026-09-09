/**
 * Where the Linear API key lives, and whether it works.
 *
 * One key for the app rather than one per project: a personal API key belongs
 * to one Linear workspace, and a second project in that workspace needs the
 * same key. Encrypted with `safeStorage` and kept in `global_settings`.
 *
 * Main process only. Nothing here is reachable from the renderer, the REST
 * router or a sandbox guest — they are told who the key belongs to, never what
 * it is.
 */

import { safeStorage } from 'electron';
import { getGlobalSetting, setGlobalSetting } from '../db';
import { getLogger } from '../logger';
import { createLinearRequest, LinearError, type FetchLike } from './client';
import { VIEWER_QUERY } from './queries';
import type { LinearCredentialStorage, LinearViewer } from './types';

const credentialLog = getLogger().scope('linear:credentials');

/** globalSettings key holding the encrypted key, base64. */
export const LINEAR_CREDENTIAL_KEY = 'linear:credential';

/** Read instead of storing one, where there is no keychain to store it in. */
export const LINEAR_ENV_VAR = 'LINEAR_API_KEY';

export interface StoredCredential {
  apiKey: string;
  storage: LinearCredentialStorage;
}

/** Whether the OS has somewhere to keep a secret. Linux with no keyring has not. */
export function canStoreCredential(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * The key, from the keychain or from the environment.
 *
 * The environment wins nothing: it is only consulted when nothing is stored,
 * which is the case on a machine that refused to store one.
 */
export async function readCredential(): Promise<StoredCredential | null> {
  const stored = await getGlobalSetting(LINEAR_CREDENTIAL_KEY);
  if (stored && canStoreCredential()) {
    try {
      return { apiKey: safeStorage.decryptString(Buffer.from(stored, 'base64')), storage: 'keychain' };
    } catch (error) {
      // A key encrypted under a keychain this machine no longer has is not a
      // key; saying so beats every later call failing as "unauthorized".
      credentialLog.warn('stored Linear key could not be decrypted', { error: (error as Error).name });
    }
  }

  const fromEnv = process.env[LINEAR_ENV_VAR]?.trim();
  return fromEnv ? { apiKey: fromEnv, storage: 'environment' } : null;
}

/**
 * Store a key, or clear it with an empty string.
 *
 * Refused where `safeStorage` has no keychain: writing it in the clear would
 * put a workspace-wide credential in a plain SQLite row. The caller is told to
 * set `LINEAR_API_KEY` instead.
 */
export async function writeCredential(apiKey: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await setGlobalSetting(LINEAR_CREDENTIAL_KEY, '');
    return { success: true };
  }
  if (!canStoreCredential()) {
    return {
      success: false,
      error: `This machine has no keychain to encrypt the key with. Set ${LINEAR_ENV_VAR} in your environment instead.`,
    };
  }
  await setGlobalSetting(LINEAR_CREDENTIAL_KEY, safeStorage.encryptString(trimmed).toString('base64'));
  return { success: true };
}

/**
 * Who the key belongs to, and which workspace it can see. The workspace id is
 * what a stored project scope is checked against, so a key re-pasted from
 * another workspace drops the scope rather than emptying the list.
 */
export async function fetchViewer(apiKey: string, fetchImpl?: FetchLike): Promise<LinearViewer> {
  const request = createLinearRequest(apiKey, fetchImpl);
  const data = await request<{
    viewer: { id: string; name: string; displayName: string; avatarUrl?: string };
    organization: { id: string; name: string };
  }>(VIEWER_QUERY);

  return {
    id: data.viewer.id,
    name: data.viewer.name,
    displayName: data.viewer.displayName,
    ...(data.viewer.avatarUrl ? { avatarUrl: data.viewer.avatarUrl } : {}),
    workspaceId: data.organization.id,
    workspaceName: data.organization.name,
  };
}

/**
 * Validity for the life of the process, as `gh auth status` is cached, with a
 * recheck so pasting a key takes effect without a restart. Changing or clearing
 * the key clears it.
 */
let cached: Promise<LinearViewer | LinearError | null> | null = null;

export function invalidateCredentialCache(): void {
  cached = null;
}

/**
 * The viewer the key resolves to, `null` when there is no key, or the error
 * that stopped it. Errors are cached too: without that, a panel open during an
 * outage asks Linear on every render.
 */
export function resolveViewer(recheck = false): Promise<LinearViewer | LinearError | null> {
  if (recheck || !cached) {
    cached = loadViewer().then((result) => {
      // A rate limit passes; the next open should ask again rather than
      // inherit a refusal that has since expired.
      if (result instanceof LinearError && result.kind === 'rate-limited') cached = null;
      return result;
    });
  }
  return cached;
}

async function loadViewer(): Promise<LinearViewer | LinearError | null> {
  const credential = await readCredential();
  if (!credential) return null;
  try {
    return await fetchViewer(credential.apiKey);
  } catch (error) {
    if (error instanceof LinearError) return error;
    return new LinearError('unknown', 'Could not check the Linear API key.');
  }
}
