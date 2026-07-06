import type { BrowserWindow } from 'electron';
import type { PtyId, PtySpawnOptions, PtySpawnResult, PtyReconnectResult, ActiveSession } from '../types';
import type { SessionOwnerSandboxProvider } from '../sandbox/provider';
import type { SandboxProviderStatus } from '../sandbox/types';
import {
  spawnSandboxedPty,
  isSandboxPty,
  writeSandboxPty,
  resizeSandboxPty,
  killSandboxPty,
  setSandboxPtyLabel,
  getActiveSandboxSessions,
  reconnectSandboxPty,
  cleanup as limaCleanup,
} from './index';
import { getLimaStatus, isLimaInstalled } from './manager';
import { stopSandboxView } from './sandboxSync';

/**
 * Lima as a `SandboxProvider`. This is a thin adapter over the existing
 * `src/lima` surface — it owns its PTY sessions (VM boot, sandbox-view worktree,
 * ref-watcher) so it is a `session-owner`. All VM-specific machinery stays
 * behind this façade; the registry and `pty.ts` only see the provider interface.
 */
export const limaProvider: SessionOwnerSandboxProvider = {
  kind: 'session-owner',
  id: 'lima',
  displayName: 'Lima VM',
  capabilities: {
    vmLifecycle: true,
    yamlConfig: true,
    sandboxView: true,
    profiles: false,
    network: false,
  },

  isAvailable(): Promise<boolean> {
    return isLimaInstalled();
  },

  async getStatus(projectPath: string): Promise<SandboxProviderStatus> {
    const status = await getLimaStatus(projectPath);
    return {
      providerId: 'lima',
      available: status.available,
      ready: status.vmStatus === 'Running',
      detail: status.vmStatus,
    };
  },

  cleanupTaskResources(projectPath: string, taskNumber: number, branch: string): Promise<void> {
    return stopSandboxView(projectPath, taskNumber, branch);
  },

  cleanup(): void {
    limaCleanup();
  },

  spawnPty(options: PtySpawnOptions, window: BrowserWindow): Promise<PtySpawnResult> {
    return spawnSandboxedPty(options, window);
  },
  ownsPty(ptyId: PtyId): boolean {
    return isSandboxPty(ptyId);
  },
  writePty(ptyId: PtyId, data: string): void {
    writeSandboxPty(ptyId, data);
  },
  resizePty(ptyId: PtyId, cols: number, rows: number): void {
    resizeSandboxPty(ptyId, cols, rows);
  },
  killPty(ptyId: PtyId): void {
    killSandboxPty(ptyId);
  },
  setPtyLabel(ptyId: PtyId, label: string): void {
    setSandboxPtyLabel(ptyId, label);
  },
  getActiveSessions(): ActiveSession[] {
    return getActiveSandboxSessions();
  },
  reconnectPty(ptyId: PtyId, window: BrowserWindow): PtyReconnectResult {
    return reconnectSandboxPty(ptyId, window);
  },
};
