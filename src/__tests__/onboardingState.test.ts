import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STATE_KEY,
  ONBOARDING_STATE_VERSION,
  mergeOnboardingPatch,
  normalizeOnboardingState,
  patchOnboardingState,
  readOnboardingState,
  serializeOnboardingState,
  type OnboardingStorageIO,
} from '../onboardingState';
import type { OnboardingState } from '../types';

const VALID_STATE: OnboardingState = {
  version: ONBOARDING_STATE_VERSION,
  firstProjectPath: '/some/path',
  source: 'created',
  seededTaskNumber: 42,
  dismissed: false,
};

describe('normalizeOnboardingState', () => {
  it('returns null for missing input', () => {
    expect(normalizeOnboardingState(null)).toBeNull();
    expect(normalizeOnboardingState(undefined)).toBeNull();
    expect(normalizeOnboardingState('')).toBeNull();
  });

  it('returns null for non-JSON input', () => {
    expect(normalizeOnboardingState('not-json')).toBeNull();
    expect(normalizeOnboardingState('{')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(normalizeOnboardingState('null')).toBeNull();
    expect(normalizeOnboardingState('42')).toBeNull();
    expect(normalizeOnboardingState('"a string"')).toBeNull();
  });

  it('fills missing fields with defaults', () => {
    const result = normalizeOnboardingState('{}');
    expect(result).toEqual({
      version: ONBOARDING_STATE_VERSION,
      firstProjectPath: '',
      source: 'added',
      seededTaskNumber: null,
      dismissed: false,
    });
  });

  it('coerces an invalid source to the default', () => {
    const result = normalizeOnboardingState(JSON.stringify({ source: 'garbage' }));
    expect(result?.source).toBe('added');
  });

  it('coerces a non-number seededTaskNumber to null', () => {
    expect(normalizeOnboardingState(JSON.stringify({ seededTaskNumber: '42' }))?.seededTaskNumber).toBeNull();
    expect(normalizeOnboardingState(JSON.stringify({ seededTaskNumber: null }))?.seededTaskNumber).toBeNull();
  });

  it('treats a non-true dismissed as false', () => {
    expect(normalizeOnboardingState(JSON.stringify({ dismissed: 1 }))?.dismissed).toBe(false);
    expect(normalizeOnboardingState(JSON.stringify({ dismissed: 'yes' }))?.dismissed).toBe(false);
    expect(normalizeOnboardingState(JSON.stringify({ dismissed: true }))?.dismissed).toBe(true);
  });

  it('round-trips a valid state', () => {
    const result = normalizeOnboardingState(serializeOnboardingState(VALID_STATE));
    expect(result).toEqual(VALID_STATE);
  });

  it('overwrites a stale version with the current one', () => {
    const result = normalizeOnboardingState(JSON.stringify({ ...VALID_STATE, version: 999 }));
    expect(result?.version).toBe(ONBOARDING_STATE_VERSION);
  });
});

describe('mergeOnboardingPatch', () => {
  it('merges over a null current with defaults', () => {
    const result = mergeOnboardingPatch(null, { firstProjectPath: '/x' });
    expect(result.firstProjectPath).toBe('/x');
    expect(result.source).toBe('added');
    expect(result.dismissed).toBe(false);
  });

  it('preserves untouched fields from the current state', () => {
    const result = mergeOnboardingPatch(VALID_STATE, { dismissed: true });
    expect(result.firstProjectPath).toBe(VALID_STATE.firstProjectPath);
    expect(result.seededTaskNumber).toBe(VALID_STATE.seededTaskNumber);
    expect(result.dismissed).toBe(true);
  });

  it('always stamps the current version even if patch tries to override it', () => {
    const result = mergeOnboardingPatch(VALID_STATE, { version: 999 as number });
    expect(result.version).toBe(ONBOARDING_STATE_VERSION);
  });
});

function makeFakeIO(initial: Record<string, string> = {}): OnboardingStorageIO & { store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    get: async (key) => store[key],
    set: async (key, value) => {
      store[key] = value;
      return { success: true };
    },
  };
}

describe('readOnboardingState', () => {
  it('returns null when nothing is stored', async () => {
    const io = makeFakeIO();
    expect(await readOnboardingState(io)).toBeNull();
  });

  it('returns the parsed state when stored', async () => {
    const io = makeFakeIO({ [ONBOARDING_STATE_KEY]: serializeOnboardingState(VALID_STATE) });
    expect(await readOnboardingState(io)).toEqual(VALID_STATE);
  });

  it('returns null for invalid stored JSON', async () => {
    const io = makeFakeIO({ [ONBOARDING_STATE_KEY]: 'not-json' });
    expect(await readOnboardingState(io)).toBeNull();
  });
});

describe('patchOnboardingState', () => {
  it('initializes state from defaults when none exists', async () => {
    const io = makeFakeIO();
    const next = await patchOnboardingState(io, { firstProjectPath: '/p', source: 'created' });
    expect(next.firstProjectPath).toBe('/p');
    expect(next.source).toBe('created');
    expect(next.dismissed).toBe(false);
    // Persisted under the right key
    expect(io.store[ONBOARDING_STATE_KEY]).toBeDefined();
  });

  it('merges patches into existing state', async () => {
    const io = makeFakeIO({ [ONBOARDING_STATE_KEY]: serializeOnboardingState(VALID_STATE) });
    const next = await patchOnboardingState(io, { dismissed: true });
    expect(next.dismissed).toBe(true);
    expect(next.firstProjectPath).toBe(VALID_STATE.firstProjectPath);
    expect(next.seededTaskNumber).toBe(VALID_STATE.seededTaskNumber);
  });

  it('persists the merged state back to storage', async () => {
    const io = makeFakeIO();
    await patchOnboardingState(io, { seededTaskNumber: 7 });
    const reparsed = normalizeOnboardingState(io.store[ONBOARDING_STATE_KEY]);
    expect(reparsed?.seededTaskNumber).toBe(7);
  });
});
