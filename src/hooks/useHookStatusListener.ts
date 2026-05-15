import { useEffect } from 'react';
import { useTerminalStore } from '../stores/terminalStore';
import { terminalInstances } from '../components/terminal/terminalReact';

/**
 * Subscribes to CLI agent hook status events (claude / codex / pi) and dispatches
 * them to the matching terminal instance. On mount, seeds existing terminals
 * with their current status so the dot reflects state captured before the
 * listener was registered.
 *
 * Pass `projectPath` to seed only that project's terminals (project view).
 * Pass `null` to seed every known terminal (home view, which shows them all).
 */
export function useHookStatusListener(projectPath: string | null): void {
  useEffect(() => {
    const cleanup = window.api.agentHooks.onStatus((ptyId, status) => {
      terminalInstances.get(ptyId)?.handleHookStatus(status as 'thinking' | 'ready');
    });

    const { terminalsByProject } = useTerminalStore.getState();
    const ptyIds =
      projectPath === null ? Object.values(terminalsByProject).flat() : (terminalsByProject[projectPath] ?? []);

    for (const ptyId of ptyIds) {
      const instance = terminalInstances.get(ptyId);
      if (!instance) continue;
      window.api.agentHooks.getStatus(ptyId).then((hookStatus) => {
        if (hookStatus?.status === 'thinking' && hookStatus.thinkingCount > 0) {
          instance.handleHookStatus('thinking');
        }
      });
    }

    return cleanup;
  }, [projectPath]);
}
