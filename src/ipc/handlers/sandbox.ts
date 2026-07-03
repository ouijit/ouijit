import { typedHandle } from '../helpers';
import { listSandboxProviders } from '../../sandbox';

/**
 * Cross-provider sandbox IPC. Reports availability/readiness for every
 * registered backend so the renderer can feature-detect (which backends to
 * offer, whether a task's chosen backend can spawn right now).
 */
export function registerSandboxHandlers(): void {
  typedHandle('sandbox:status', async (projectPath) => {
    const providers = listSandboxProviders();
    return Promise.all(providers.map((p) => p.getStatus(projectPath)));
  });
}
