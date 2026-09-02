import { describe, test, expect } from 'vitest';
import { applyExperimentalSandboxGate } from '../ipc/handlers/sandbox';
import { DEFAULT_EXPERIMENTAL_FLAGS, parseExperimentalFlags } from '../experimentalFlags';
import type { SandboxProviderStatus } from '../sandbox/types';

const lima: SandboxProviderStatus = { providerId: 'lima', available: true, ready: true, detail: 'Running' };
const nono: SandboxProviderStatus = { providerId: 'nono', available: true, ready: true, detail: 'Ready' };
const custom: SandboxProviderStatus = { providerId: 'custom', available: true, ready: true, detail: 'Ready' };

describe('applyExperimentalSandboxGate', () => {
  test('gates nono and custom off until a project opts in, leaving other backends untouched', () => {
    // Off by default — whether the flags come from the default constant or an
    // absent stored value: nono is reported unavailable with a reason the UI
    // can surface, and Lima passes through unchanged.
    for (const flags of [DEFAULT_EXPERIMENTAL_FLAGS, parseExperimentalFlags(undefined)]) {
      const gated = applyExperimentalSandboxGate([lima, nono, custom], flags);
      expect(gated.find((s) => s.providerId === 'lima')).toEqual(lima);
      for (const id of ['nono', 'custom'] as const) {
        const gatedBackend = gated.find((s) => s.providerId === id);
        expect(gatedBackend).toMatchObject({ available: false, ready: false });
        expect(gatedBackend?.detail).toMatch(/experimental/i);
      }
    }
    // Each flag opens only its own backend.
    expect(applyExperimentalSandboxGate([lima, nono, custom], { ...DEFAULT_EXPERIMENTAL_FLAGS, nono: true })).toEqual([
      lima,
      nono,
      expect.objectContaining({ providerId: 'custom', available: false }),
    ]);
    expect(
      applyExperimentalSandboxGate([lima, nono, custom], { ...DEFAULT_EXPERIMENTAL_FLAGS, customSandbox: true }),
    ).toEqual([lima, expect.objectContaining({ providerId: 'nono', available: false }), custom]);
  });
});
