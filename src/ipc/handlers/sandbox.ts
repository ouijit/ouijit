import { typedHandle } from '../helpers';
import { getGlobalSetting } from '../../db';
import { type ExperimentalFlags, experimentalStorageKey, parseExperimentalFlags } from '../../experimentalFlags';
import { listSandboxProviders } from '../../sandbox';
import { getNonoConfig, setNonoConfig } from '../../sandbox/nono/config';
import type { SandboxProviderStatus } from '../../sandbox/types';

/**
 * Apply the experimental product gate to raw provider statuses. Providers
 * report physical availability (installed + platform-supported); nono is still
 * an experimental backend, so until a project opts in it is reported
 * unavailable. Everything downstream — the picker, the Open in menu, and the
 * spawn funnel's resolveAvailableProvider — derives from status, so this one
 * gate covers all of them. Pure so it is unit-testable without IPC.
 */
export function applyExperimentalSandboxGate(
  statuses: SandboxProviderStatus[],
  flags: ExperimentalFlags,
): SandboxProviderStatus[] {
  return statuses.map((s) =>
    s.providerId === 'nono' && !flags.nono
      ? { ...s, available: false, ready: false, detail: 'Experimental — enable in Project Settings' }
      : s,
  );
}

/**
 * Cross-provider sandbox IPC. Reports availability/readiness for every
 * registered backend so the renderer can feature-detect (which backends to
 * offer, whether a task's chosen backend can spawn right now), plus the nono
 * config surface (the Lima config surface stays on the `lima:*` channels).
 */
export function registerSandboxHandlers(): void {
  typedHandle('sandbox:status', async (projectPath) => {
    const providers = listSandboxProviders();
    const [statuses, flags] = await Promise.all([
      Promise.all(providers.map((p) => p.getStatus(projectPath))),
      getGlobalSetting(experimentalStorageKey(projectPath)).then(parseExperimentalFlags),
    ]);
    return applyExperimentalSandboxGate(statuses, flags);
  });

  typedHandle('sandbox:nono-config', (projectPath) => getNonoConfig(projectPath));
  typedHandle('sandbox:set-nono-config', (projectPath, config) => setNonoConfig(projectPath, config));
}
