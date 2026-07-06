import { describe, test, expect } from 'vitest';
import { applyExperimentalSandboxGate } from '../ipc/handlers/sandbox';
import { DEFAULT_EXPERIMENTAL_FLAGS, parseExperimentalFlags } from '../experimentalFlags';
import type { SandboxProviderStatus } from '../sandbox/types';

const lima: SandboxProviderStatus = { providerId: 'lima', available: true, ready: true, detail: 'Running' };
const nono: SandboxProviderStatus = { providerId: 'nono', available: true, ready: true, detail: 'Ready' };

describe('applyExperimentalSandboxGate', () => {
  test('gates nono off until a project opts in, leaving other backends untouched', () => {
    // Off by default — whether the flags come from the default constant or an
    // absent stored value: nono is reported unavailable with a reason the UI
    // can surface, and Lima passes through unchanged.
    for (const flags of [DEFAULT_EXPERIMENTAL_FLAGS, parseExperimentalFlags(undefined)]) {
      const gated = applyExperimentalSandboxGate([lima, nono], flags);
      expect(gated.find((s) => s.providerId === 'lima')).toEqual(lima);
      const gatedNono = gated.find((s) => s.providerId === 'nono');
      expect(gatedNono).toMatchObject({ available: false, ready: false });
      expect(gatedNono?.detail).toMatch(/experimental/i);
    }
    // Enabled: nono passes through untouched.
    expect(applyExperimentalSandboxGate([lima, nono], { canvas: false, nono: true })).toEqual([lima, nono]);
  });
});
