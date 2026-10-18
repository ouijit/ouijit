import { useAppStore } from '../../stores/appStore';
import { availableBackends, useProjectDataStore } from '../../stores/projectDataStore';
import type { ProjectHooks, SandboxProviderId, SandboxProviderStatus, Script, TaskWithWorkspace } from '../../types';

/** Puts a project's data where a running app would have loaded it. */
export function seedProject(
  projectPath: string,
  data: {
    tasks?: TaskWithWorkspace[];
    hooks?: ProjectHooks;
    sandboxStatuses?: SandboxProviderStatus[];
    runnerSandbox?: SandboxProviderId;
    scripts?: Script[];
  },
): void {
  if (data.tasks) useAppStore.getState().updateProjectTaskCache(projectPath, data.tasks);
  if (data.hooks || data.sandboxStatuses || data.runnerSandbox) {
    const statuses = data.sandboxStatuses ?? [];
    useProjectDataStore.setState((s) => ({
      configByProject: {
        ...s.configByProject,
        [projectPath]: {
          sandboxStatuses: statuses,
          availableSandboxProviders: availableBackends(statuses),
          hooks: data.hooks ?? {},
          runnerSandbox: data.runnerSandbox ?? 'none',
        },
      },
    }));
  }
  if (data.scripts) {
    useProjectDataStore.setState((s) => ({
      scriptsByProject: { ...s.scriptsByProject, [projectPath]: data.scripts! },
    }));
  }
}
