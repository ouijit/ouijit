import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  registerSandboxProvider,
  getSandboxProvider,
  listSandboxProviders,
  listSessionOwners,
  findSessionOwner,
  cleanupSandboxProviders,
  _resetSandboxRegistryForTesting,
} from '../sandbox/registry';
import type { SessionOwnerSandboxProvider, WrapperSandboxProvider } from '../sandbox/provider';
import type { SandboxBackendId } from '../sandbox/types';

function makeSessionOwner(id: SandboxBackendId, prefix: string): SessionOwnerSandboxProvider {
  return {
    kind: 'session-owner',
    id,
    displayName: id,
    capabilities: { vmLifecycle: true, yamlConfig: true, sandboxView: true, profiles: false, network: false },
    isAvailable: async () => true,
    getStatus: async () => ({ providerId: id, available: true, ready: true }),
    cleanup: vi.fn(),
    spawnPty: async () => ({ success: true, ptyId: `${prefix}-1` }),
    ownsPty: (ptyId: string) => ptyId.startsWith(prefix),
    writePty: vi.fn(),
    resizePty: vi.fn(),
    killPty: vi.fn(),
    setPtyLabel: vi.fn(),
    getActiveSessions: () => [],
    reconnectPty: () => ({ success: true }),
  };
}

function makeWrapper(id: SandboxBackendId): WrapperSandboxProvider {
  return {
    kind: 'wrapper',
    id,
    displayName: id,
    capabilities: { vmLifecycle: false, yamlConfig: false, sandboxView: false, profiles: true, network: true },
    isAvailable: async () => true,
    getStatus: async () => ({ providerId: id, available: true, ready: true }),
    cleanup: vi.fn(),
    prepare: async (ctx) => ({ cwd: ctx.cwd }),
    wrapLaunch: (launch) => launch,
  };
}

beforeEach(() => {
  _resetSandboxRegistryForTesting();
});

describe('sandbox registry', () => {
  test('resolves a registered provider by id; none / unknown / undefined yield undefined', () => {
    const lima = makeSessionOwner('lima', 'lima');
    registerSandboxProvider(lima);

    expect(getSandboxProvider('lima')).toBe(lima);
    expect(getSandboxProvider('none')).toBeUndefined();
    expect(getSandboxProvider(undefined)).toBeUndefined();
    // 'nono' not registered in this test
    expect(getSandboxProvider('nono')).toBeUndefined();
  });

  test('duplicate registration of the same id throws', () => {
    registerSandboxProvider(makeSessionOwner('lima', 'lima'));
    expect(() => registerSandboxProvider(makeSessionOwner('lima', 'lima'))).toThrow(/already registered/);
  });

  test('listSessionOwners returns only session-owner providers', () => {
    const lima = makeSessionOwner('lima', 'lima');
    const nono = makeWrapper('nono');
    registerSandboxProvider(lima);
    registerSandboxProvider(nono);

    expect(listSandboxProviders()).toHaveLength(2);
    expect(listSessionOwners()).toEqual([lima]);
  });

  test('findSessionOwner routes a ptyId to the owning session-owner', () => {
    const lima = makeSessionOwner('lima', 'lima');
    const nono = makeWrapper('nono');
    registerSandboxProvider(lima);
    registerSandboxProvider(nono);

    expect(findSessionOwner('lima-abc')).toBe(lima);
    // A host / wrapper ptyId is owned by no session-owner.
    expect(findSessionOwner('pty-xyz')).toBeUndefined();
  });

  test('cleanupSandboxProviders calls every provider cleanup exactly once', () => {
    const lima = makeSessionOwner('lima', 'lima');
    const nono = makeWrapper('nono');
    registerSandboxProvider(lima);
    registerSandboxProvider(nono);

    cleanupSandboxProviders();

    expect(lima.cleanup).toHaveBeenCalledTimes(1);
    expect(nono.cleanup).toHaveBeenCalledTimes(1);
  });
});
