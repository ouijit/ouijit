import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { LimaStatus } from '../lima/types';

import { limaProvider } from '../lima/provider';

// The Lima provider is a thin adapter over the real lima surface. Mock the
// heavy submodules (node-pty, limactl, git) so the test exercises only the
// adapter's mapping logic.
const getLimaStatus = vi.fn<(projectPath: string) => Promise<LimaStatus>>();
const isLimaInstalled = vi.fn<() => Promise<boolean>>();
const limaCleanup = vi.fn();
const stopSandboxView = vi.fn<() => Promise<void>>();

vi.mock('../lima/index', () => ({
  spawnSandboxedPty: vi.fn(),
  isSandboxPty: (ptyId: string) => ptyId.startsWith('pty-sandbox'),
  writeSandboxPty: vi.fn(),
  resizeSandboxPty: vi.fn(),
  killSandboxPty: vi.fn(),
  setSandboxPtyLabel: vi.fn(),
  getActiveSandboxSessions: () => [],
  reconnectSandboxPty: vi.fn(),
  cleanup: () => limaCleanup(),
}));
vi.mock('../lima/manager', () => ({
  getLimaStatus: (p: string) => getLimaStatus(p),
  isLimaInstalled: () => isLimaInstalled(),
}));
vi.mock('../lima/sandboxSync', () => ({
  stopSandboxView: (...args: unknown[]) => stopSandboxView(...(args as [])),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('limaProvider', () => {
  test('advertises the Lima capability surface (VM lifecycle + YAML + sandbox view)', () => {
    expect(limaProvider.kind).toBe('session-owner');
    expect(limaProvider.id).toBe('lima');
    expect(limaProvider.capabilities).toEqual({
      vmLifecycle: true,
      yamlConfig: true,
      sandboxView: true,
      profiles: false,
      network: false,
    });
  });

  test('getStatus maps a Running VM to ready:true with the vmStatus detail', async () => {
    getLimaStatus.mockResolvedValue({ available: true, vmStatus: 'Running', instanceName: 'ouijit-abc' });
    const status = await limaProvider.getStatus('/proj');
    expect(status).toEqual({ providerId: 'lima', available: true, ready: true, detail: 'Running' });
  });

  test('getStatus maps a Stopped VM to ready:false (available but not spawnable)', async () => {
    getLimaStatus.mockResolvedValue({ available: true, vmStatus: 'Stopped', instanceName: 'ouijit-abc' });
    const status = await limaProvider.getStatus('/proj');
    expect(status).toEqual({ providerId: 'lima', available: true, ready: false, detail: 'Stopped' });
  });

  test('getStatus maps missing limactl to available:false', async () => {
    getLimaStatus.mockResolvedValue({ available: false, vmStatus: 'Unavailable' });
    const status = await limaProvider.getStatus('/proj');
    expect(status).toEqual({ providerId: 'lima', available: false, ready: false, detail: 'Unavailable' });
  });

  test('isAvailable delegates to isLimaInstalled', async () => {
    isLimaInstalled.mockResolvedValue(true);
    expect(await limaProvider.isAvailable()).toBe(true);
    expect(isLimaInstalled).toHaveBeenCalledTimes(1);
  });

  test('cleanupTaskResources stops the sandbox view for the task branch', async () => {
    await limaProvider.cleanupTaskResources?.('/proj', 7, 'feature-x');
    expect(stopSandboxView).toHaveBeenCalledWith('/proj', 7, 'feature-x');
  });

  test('ownsPty recognises sandbox ptyIds', () => {
    expect(limaProvider.ownsPty('pty-sandbox-1')).toBe(true);
    expect(limaProvider.ownsPty('pty-1')).toBe(false);
  });
});
