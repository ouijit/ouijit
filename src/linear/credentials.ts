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
import type { LinearCredentialSource, LinearCredentialStorage, LinearViewer } from './types';

const credentialLog = getLogger().scope('linear:credentials');

/** globalSettings key holding the encrypted key, base64. */
export const LINEAR_CREDENTIAL_KEY = 'linear:credential';

/**
 * Where a project's own key lives, when it has one.
 *
 * A key resolves to exactly one workspace — the API has no shape that returns
 * two — so a person working across two of them needs a key per workspace. The
 * app-wide key is the default and the override is the exception, which is why
 * the app-wide one keeps the unsuffixed name it was already stored under.
 */
export function linearCredentialKey(projectPath?: string): string {
  return projectPath ? `${LINEAR_CREDENTIAL_KEY}:${projectPath}` : LINEAR_CREDENTIAL_KEY;
}

/** Read instead of storing one, where there is no keychain to store it in. */
export const LINEAR_ENV_VAR = 'LINEAR_API_KEY';

export interface StoredCredential {
  apiKey: string;
  storage: LinearCredentialStorage;
  /** Which key this is: the app's, or one this project keeps for itself. */
  source: LinearCredentialSource;
}

/** Whether the OS has somewhere to keep a secret. Linux with no keyring has not. */
export function canStoreCredential(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * The key a project reads Linear with: its own if it keeps one, else the app's,
 * else the environment.
 *
 * The environment wins nothing: it is only consulted when nothing is stored,
 * which is the case on a machine that refused to store one.
 */
export async function readCredential(projectPath?: string): Promise<StoredCredential | null> {
  if (projectPath) {
    const own = await decrypt(linearCredentialKey(projectPath));
    if (own) return { apiKey: own, storage: 'keychain', source: 'project' };
  }

  const shared = await decrypt(LINEAR_CREDENTIAL_KEY);
  if (shared) return { apiKey: shared, storage: 'keychain', source: 'app' };

  const fromEnv = process.env[LINEAR_ENV_VAR]?.trim();
  return fromEnv ? { apiKey: fromEnv, storage: 'environment', source: 'app' } : null;
}

async function decrypt(key: string): Promise<string | null> {
  const stored = await getGlobalSetting(key);
  if (!stored || !canStoreCredential()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch (error) {
    // A key encrypted under a keychain this machine no longer has is not a
    // key; saying so beats every later call failing as "unauthorized".
    credentialLog.warn('stored Linear key could not be decrypted', { key, error: (error as Error).name });
    return null;
  }
}

/**
 * Enough of the key to recognise, and never enough to use: the prefix Linear
 * mints them with and the last four characters. Without it a row showing only
 * an account name never looks like somewhere a secret is stored.
 */
export function maskCredential(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return apiKey.length > 12 ? `${apiKey.slice(0, 8)}••••${tail}` : `••••${tail}`;
}

/** Whether this project keeps a key of its own, without reading it. */
export async function hasOwnCredential(projectPath: string): Promise<boolean> {
  return Boolean(await getGlobalSetting(linearCredentialKey(projectPath)));
}

/**
 * Store a key, or clear it with an empty string.
 *
 * Refused where `safeStorage` has no keychain: writing it in the clear would
 * put a workspace-wide credential in a plain SQLite row. The caller is told to
 * set `LINEAR_API_KEY` instead.
 */
export async function writeCredential(
  apiKey: string,
  projectPath?: string,
): Promise<{ success: boolean; error?: string }> {
  const key = linearCredentialKey(projectPath);
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await setGlobalSetting(key, '');
    return { success: true };
  }
  if (!canStoreCredential()) {
    return {
      success: false,
      error: `No keychain available to encrypt the key. Set ${LINEAR_ENV_VAR} in your environment instead.`,
    };
  }
  await setGlobalSetting(key, safeStorage.encryptString(trimmed).toString('base64'));
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
 * recheck so pasting a key takes effect without a restart.
 *
 * Per project rather than per process: a project with its own key resolves to
 * its own workspace, and one entry would answer for the wrong one. Projects on
 * the app-wide key share the entry under `APP`, which is most of them.
 */
const APP = '\u0000app';
const cached = new Map<string, Promise<LinearViewer | LinearError | null>>();

/** Clears one project's answer, or every one when the app-wide key changed. */
export function invalidateCredentialCache(projectPath?: string): void {
  if (projectPath) cached.delete(projectPath);
  else cached.clear();
}

/**
 * The viewer the project's key resolves to, `null` when there is no key, or the
 * error that stopped it. Errors are cached too: without that, a panel open
 * during an outage asks Linear on every render.
 */
export function resolveViewer(projectPath?: string, recheck = false): Promise<LinearViewer | LinearError | null> {
  const entry = projectPath ?? APP;
  const existing = cached.get(entry);
  if (!recheck && existing) return existing;

  const pending = loadViewer(projectPath).then((result) => {
    // A rate limit passes; the next open should ask again rather than inherit
    // a refusal that has since expired.
    if (result instanceof LinearError && result.kind === 'rate-limited') cached.delete(entry);
    return result;
  });
  cached.set(entry, pending);
  return pending;
}

async function loadViewer(projectPath?: string): Promise<LinearViewer | LinearError | null> {
  const credential = await readCredential(projectPath);
  if (!credential) return null;
  try {
    return await fetchViewer(credential.apiKey);
  } catch (error) {
    if (error instanceof LinearError) return error;
    return new LinearError('unknown', 'Could not check the Linear API key.');
  }
}
