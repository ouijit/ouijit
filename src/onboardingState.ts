import type { FirstProjectSource, OnboardingState } from './types';

export const ONBOARDING_STATE_KEY = 'onboarding:state';
export const ONBOARDING_STATE_VERSION = 1;

const DEFAULT_STATE: OnboardingState = {
  version: ONBOARDING_STATE_VERSION,
  firstProjectPath: '',
  source: 'added',
  seededTaskNumber: null,
  dismissed: false,
};

/**
 * Parses a raw serialized blob and returns a known-shape OnboardingState, or
 * null if no state exists yet. Missing fields fall back to defaults so older
 * persisted blobs still produce a valid object. Future schema changes should
 * bump ONBOARDING_STATE_VERSION and add a `parsed.version === X` branch here
 * to migrate forward.
 */
export function normalizeOnboardingState(raw: string | undefined | null): OnboardingState | null {
  if (raw == null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const source: FirstProjectSource =
    obj.source === 'created' || obj.source === 'added' ? obj.source : DEFAULT_STATE.source;
  return {
    version: ONBOARDING_STATE_VERSION,
    firstProjectPath: typeof obj.firstProjectPath === 'string' ? obj.firstProjectPath : DEFAULT_STATE.firstProjectPath,
    source,
    seededTaskNumber: typeof obj.seededTaskNumber === 'number' ? obj.seededTaskNumber : null,
    dismissed: obj.dismissed === true,
  };
}

export function serializeOnboardingState(state: OnboardingState): string {
  return JSON.stringify(state);
}

export function mergeOnboardingPatch(
  current: OnboardingState | null,
  patch: Partial<OnboardingState>,
): OnboardingState {
  const base = current ?? DEFAULT_STATE;
  return { ...base, ...patch, version: ONBOARDING_STATE_VERSION };
}

/**
 * Minimal storage interface so the read/patch helpers can be reused from
 * both the main process (db functions) and the renderer (window.api), each
 * passing in their own get/set.
 */
export interface OnboardingStorageIO {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<{ success: boolean }>;
}

export async function readOnboardingState(io: OnboardingStorageIO): Promise<OnboardingState | null> {
  const raw = await io.get(ONBOARDING_STATE_KEY);
  return normalizeOnboardingState(raw ?? null);
}

export async function patchOnboardingState(
  io: OnboardingStorageIO,
  patch: Partial<OnboardingState>,
): Promise<OnboardingState> {
  const current = await readOnboardingState(io);
  const next = mergeOnboardingPatch(current, patch);
  await io.set(ONBOARDING_STATE_KEY, serializeOnboardingState(next));
  return next;
}
