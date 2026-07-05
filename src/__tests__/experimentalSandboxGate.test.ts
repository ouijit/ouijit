import { describe, test, expect } from 'vitest';
import { applyExperimentalSandboxGate } from '../ipc/handlers/sandbox';
import { DEFAULT_EXPERIMENTAL_FLAGS, parseExperimentalFlags } from '../experimentalFlags';
import type { SandboxProviderStatus } from '../sandbox/types';

const lima: SandboxProviderStatus = { providerId: 'lima', available: true, ready: true, detail: 'Running' };
const nono: SandboxProviderStatus = { providerId: 'nono', available: true, ready: true, detail: 'Ready' };

describe('applyExperimentalSandboxGate', () => {
  test('hides nono when the experimental flag is off (the default)', () => {
    const gated = applyExperimentalSandboxGate([lima, nono], DEFAULT_EXPERIMENTAL_FLAGS);
    expect(gated.find((s) => s.providerId === 'nono')).toMatchObject({ available: false, ready: false });
    // Lima is untouched.
    expect(gated.find((s) => s.providerId === 'lima')).toEqual(lima);
  });

  test('passes nono through unchanged when the flag is on', () => {
    const gated = applyExperimentalSandboxGate([lima, nono], { canvas: false, nono: true });
    expect(gated.find((s) => s.providerId === 'nono')).toEqual(nono);
  });

  test('a gated nono keeps a reason so the UI can explain why it is absent', () => {
    const [gated] = applyExperimentalSandboxGate([nono], { canvas: false, nono: false });
    expect(gated.detail).toMatch(/experimental/i);
  });

  test('nono is off by default when no flags are stored', () => {
    const flags = parseExperimentalFlags(undefined);
    const gated = applyExperimentalSandboxGate([nono], flags);
    expect(gated[0].available).toBe(false);
  });
});
