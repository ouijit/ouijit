import { typedHandle } from '../helpers';
import { getGlobalSetting } from '../../db';
import { type ExperimentalFlags, experimentalStorageKey, parseExperimentalFlags } from '../../experimentalFlags';
import { listSandboxProviders } from '../../sandbox';
import { getNonoConfig, setNonoConfig } from '../../sandbox/nono/config';
import { getCustomSandboxConfig, setCustomSandboxConfig } from '../../sandbox/custom/config';
import type { SandboxBackendId, SandboxProviderStatus } from '../../sandbox/types';

/**
 * The flag each backend stays unavailable behind until the project turns it on.
 * Keyed by id so a new backend is a compile error until it declares its gate.
 */
const EXPERIMENTAL_BACKEND_FLAG: Record<SandboxBackendId, keyof ExperimentalFlags> = {
  nono: 'nono',
  custom: 'customSandbox',
};

/**
 * Apply the experimental product gate to raw provider statuses. Providers
 * report physical availability (installed + platform-supported); every backend
 * is still experimental, so until a project opts in it is reported unavailable.
 * Status is the only availability signal the renderer and the spawn funnel
 * have, so this is the single gate.
 */
export function applyExperimentalSandboxGate(
  statuses: SandboxProviderStatus[],
  flags: ExperimentalFlags,
): SandboxProviderStatus[] {
  return statuses.map((s) =>
    flags[EXPERIMENTAL_BACKEND_FLAG[s.providerId]]
      ? s
      : { ...s, available: false, ready: false, detail: 'Experimental — enable in Project Settings' },
  );
}

/**
 * Cross-provider sandbox IPC. Reports availability/readiness for every
 * registered backend so the renderer can feature-detect (which backends to
 * offer, whether a task's chosen backend can spawn right now), plus each
 * backend's own config surface.
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
  typedHandle('sandbox:custom-config', (projectPath) => getCustomSandboxConfig(projectPath));
  typedHandle('sandbox:set-custom-config', (projectPath, config) => setCustomSandboxConfig(projectPath, config));
}
