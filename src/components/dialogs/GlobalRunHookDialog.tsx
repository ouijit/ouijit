import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { RunHookDialog } from './RunHookDialog';

export function GlobalRunHookDialog() {
  const queue = useProjectStore((s) => s.runHookQueue);
  const total = useProjectStore((s) => s.runHookQueueTotal);
  const request = queue[0];
  const elsewhere = useAppStore((s) =>
    request && request.projectPath !== s.activeProjectPath
      ? (s.projects.find((p) => p.path === request.projectPath)?.name ?? request.projectPath)
      : undefined,
  );
  if (!request) return null;
  // Held fixed while the queue drains, so the stepper counts up.
  const position = total - queue.length + 1;
  return (
    <RunHookDialog
      key={request.id}
      projectPath={request.projectPath}
      projectName={elsewhere}
      hookType={request.hookType}
      hook={request.hook}
      sandbox={request.sandbox}
      taskName={request.task.name}
      queuePosition={position}
      queueTotal={total}
      onClose={(result) => useProjectStore.getState().resolveRunHookRequest(request.id, result)}
      onRunAll={(result) => useProjectStore.getState().runAllRunHookRequests(result)}
      onSkipAll={() => useProjectStore.getState().skipAllRunHookRequests()}
    />
  );
}
