import { typedHandle } from '../helpers';
import { listSandboxProviders } from '../../sandbox';
import { getNonoConfig, setNonoConfig, listNonoProfiles } from '../../sandbox/nono/config';

/**
 * Cross-provider sandbox IPC. Reports availability/readiness for every
 * registered backend so the renderer can feature-detect (which backends to
 * offer, whether a task's chosen backend can spawn right now), plus the nono
 * config surface (the Lima config surface stays on the `lima:*` channels).
 */
export function registerSandboxHandlers(): void {
  typedHandle('sandbox:status', async (projectPath) => {
    const providers = listSandboxProviders();
    return Promise.all(providers.map((p) => p.getStatus(projectPath)));
  });

  typedHandle('sandbox:nono-config', (projectPath) => getNonoConfig(projectPath));
  typedHandle('sandbox:set-nono-config', (projectPath, config) => setNonoConfig(projectPath, config));
  typedHandle('sandbox:nono-profiles', () => listNonoProfiles());
}
