import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  registerSandboxProvider,
  getSandboxProvider,
  listSandboxProviders,
  cleanupSandboxProviders,
  _resetSandboxRegistryForTesting,
} from '../sandbox/registry';
import type { SandboxProvider } from '../sandbox/provider';
import type { SandboxBackendId } from '../sandbox/types';

function makeProvider(id: SandboxBackendId): SandboxProvider {
  return {
    id,
    displayName: id,
    getStatus: async () => ({ providerId: id, available: true }),
    cleanup: vi.fn(),
    prepare: async (ctx) => ({ cwd: ctx.cwd }),
    wrapLaunch: async (launch) => launch,
  };
}

beforeEach(() => {
  _resetSandboxRegistryForTesting();
});

describe('sandbox registry', () => {
  test('resolves a registered provider by id; none / unknown / undefined yield undefined', () => {
    const nono = makeProvider('nono');
    registerSandboxProvider(nono);

    expect(getSandboxProvider('nono')).toBe(nono);
    expect(getSandboxProvider('none')).toBeUndefined();
    expect(getSandboxProvider(undefined)).toBeUndefined();
    expect(getSandboxProvider('custom')).toBeUndefined();
  });

  test('duplicate registration of the same id throws', () => {
    registerSandboxProvider(makeProvider('nono'));
    expect(() => registerSandboxProvider(makeProvider('nono'))).toThrow(/already registered/);
  });

  test('cleanupSandboxProviders calls every registered provider cleanup exactly once', () => {
    const nono = makeProvider('nono');
    const custom = makeProvider('custom');
    registerSandboxProvider(nono);
    registerSandboxProvider(custom);

    expect(listSandboxProviders()).toHaveLength(2);

    cleanupSandboxProviders();

    expect(nono.cleanup).toHaveBeenCalledTimes(1);
    expect(custom.cleanup).toHaveBeenCalledTimes(1);
  });
});
