import { describe, test, expect } from 'vitest';
import { applyExperimentalSandboxGate } from '../ipc/handlers/sandbox';
import { DEFAULT_EXPERIMENTAL_FLAGS, parseExperimentalFlags } from '../experimentalFlags';
import type { SandboxProviderStatus } from '../sandbox/types';

const nono: SandboxProviderStatus = { providerId: 'nono', available: true, ready: true, detail: 'Ready' };
const custom: SandboxProviderStatus = { providerId: 'custom', available: true, ready: true, detail: 'Ready' };

describe('applyExperimentalSandboxGate', () => {
  test('each backend is gated off until its own flag is on', () => {
    // Off by default — whether the flags come from the default constant or an
    // absent stored value: a backend is reported unavailable with a reason the
    // UI can surface.
    for (const flags of [DEFAULT_EXPERIMENTAL_FLAGS, parseExperimentalFlags(undefined)]) {
      for (const gated of applyExperimentalSandboxGate([nono, custom], flags)) {
        expect(gated).toMatchObject({ available: false, ready: false });
        expect(gated.detail).toMatch(/experimental/i);
      }
    }

    // A flag opens only its own backend.
    expect(applyExperimentalSandboxGate([nono, custom], { ...DEFAULT_EXPERIMENTAL_FLAGS, nono: true })).toEqual([
      nono,
      expect.objectContaining({ providerId: 'custom', available: false }),
    ]);
    expect(
      applyExperimentalSandboxGate([nono, custom], { ...DEFAULT_EXPERIMENTAL_FLAGS, customSandbox: true }),
    ).toEqual([expect.objectContaining({ providerId: 'nono', available: false }), custom]);
  });
});
