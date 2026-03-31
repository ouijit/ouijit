import { useCallback } from 'react';
import { terminalInstances } from './terminalReact';
import { spawnRunner } from './terminalActions';
import type { RunnerScript } from '../../types';

export function useTerminalPanels(ptyId: string | null) {
  const toggleDiffPanel = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.diffPanelOpen = !instance.diffPanelOpen;
    if (instance.diffPanelOpen && instance.runnerPanelOpen) {
      instance.runnerPanelOpen = false;
      instance.pushDisplayState({ diffPanelOpen: true, runnerPanelOpen: false });
    } else {
      instance.pushDisplayState({ diffPanelOpen: instance.diffPanelOpen });
    }
    if (!instance.diffPanelOpen) {
      requestAnimationFrame(() => instance.fit());
    }
  }, [ptyId]);

  const closeDiffPanel = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.diffPanelOpen = false;
    instance.pushDisplayState({ diffPanelOpen: false });
    requestAnimationFrame(() => instance.fit());
  }, [ptyId]);

  const toggleRunner = useCallback(
    (script?: RunnerScript) => {
      if (!ptyId) return;
      const instance = terminalInstances.get(ptyId);
      if (!instance) return;
      if (instance.runner?.ptyId && !script) {
        instance.runnerPanelOpen = !instance.runnerPanelOpen;
        if (instance.runnerPanelOpen && instance.diffPanelOpen) {
          instance.diffPanelOpen = false;
          instance.pushDisplayState({ runnerPanelOpen: true, diffPanelOpen: false });
        } else {
          instance.pushDisplayState({ runnerPanelOpen: instance.runnerPanelOpen });
        }
      } else {
        spawnRunner(ptyId, script);
      }
    },
    [ptyId],
  );

  const collapseRunner = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.runnerPanelOpen = false;
    instance.pushDisplayState({ runnerPanelOpen: false });
  }, [ptyId]);

  const killRunner = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.killRunner();
    requestAnimationFrame(() => instance.fit());
  }, [ptyId]);

  const restartRunner = useCallback(async () => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    const script = instance.runnerScript;
    instance.killRunner();
    // Re-run whatever was last run (ad-hoc script or run hook)
    await spawnRunner(ptyId, script ?? undefined);
    // Re-open panel since restart is triggered from within the open panel
    if (instance.runner?.ptyId) {
      instance.runnerPanelOpen = true;
      instance.runnerFullWidth = true;
      instance.pushDisplayState({ runnerPanelOpen: true, runnerFullWidth: true });
    }
  }, [ptyId]);

  return { toggleDiffPanel, closeDiffPanel, toggleRunner, collapseRunner, killRunner, restartRunner };
}
