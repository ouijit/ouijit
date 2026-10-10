import { typedHandle } from '../helpers';
import { listSandboxProviders } from '../../sandbox';
import { getNonoConfig, setNonoConfig } from '../../sandbox/nono/config';
import { getCustomSandboxConfig, setCustomSandboxConfig } from '../../sandbox/custom/config';

/**
 * Cross-provider sandbox IPC. Reports availability for every
 * registered backend so the renderer can feature-detect (which backends to
 * offer, whether a chosen backend can spawn right now), plus each
 * backend's own config surface.
 */
export function registerSandboxHandlers(): void {
  typedHandle('sandbox:status', (projectPath) =>
    Promise.all(listSandboxProviders().map((p) => p.getStatus(projectPath))),
  );

  typedHandle('sandbox:nono-config', (projectPath) => getNonoConfig(projectPath));
  typedHandle('sandbox:set-nono-config', (projectPath, config) => setNonoConfig(projectPath, config));
  typedHandle('sandbox:custom-config', (projectPath) => getCustomSandboxConfig(projectPath));
  typedHandle('sandbox:set-custom-config', (projectPath, config) => setCustomSandboxConfig(projectPath, config));
}
