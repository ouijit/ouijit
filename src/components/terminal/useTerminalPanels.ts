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
    if (instance.diffPanelOpen) {
      instance.runnerPanelOpen = false;
      instance.planPanelOpen = false;
      instance.webPreviewPanelOpen = false;
      instance.pushDisplayState({
        diffPanelOpen: true,
        runnerPanelOpen: false,
        planPanelOpen: false,
        webPreviewPanelOpen: false,
      });
    } else {
      instance.pushDisplayState({ diffPanelOpen: false });
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
        if (instance.runnerPanelOpen) {
          instance.diffPanelOpen = false;
          instance.planPanelOpen = false;
          instance.webPreviewPanelOpen = false;
          instance.pushDisplayState({
            runnerPanelOpen: true,
            diffPanelOpen: false,
            planPanelOpen: false,
            webPreviewPanelOpen: false,
          });
        } else {
          instance.pushDisplayState({ runnerPanelOpen: false });
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

  const togglePlanPanel = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.planPanelOpen = !instance.planPanelOpen;
    if (instance.planPanelOpen) {
      instance.diffPanelOpen = false;
      instance.runnerPanelOpen = false;
      instance.webPreviewPanelOpen = false;
      instance.pushDisplayState({
        planPanelOpen: true,
        diffPanelOpen: false,
        runnerPanelOpen: false,
        webPreviewPanelOpen: false,
      });
    } else {
      instance.pushDisplayState({ planPanelOpen: false });
      requestAnimationFrame(() => instance.fit());
    }
  }, [ptyId]);

  const closePlanPanel = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.planPanelOpen = false;
    instance.pushDisplayState({ planPanelOpen: false });
    requestAnimationFrame(() => instance.fit());
  }, [ptyId]);

  const changePlanFile = useCallback(
    (newPath: string) => {
      if (!ptyId) return;
      const instance = terminalInstances.get(ptyId);
      if (!instance) return;
      instance.planPath = newPath;
      instance.pushDisplayState({ planPath: newPath });
    },
    [ptyId],
  );

  const toggleWebPreviewPanel = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.webPreviewPanelOpen = !instance.webPreviewPanelOpen;
    if (instance.webPreviewPanelOpen) {
      instance.diffPanelOpen = false;
      instance.runnerPanelOpen = false;
      instance.planPanelOpen = false;
      instance.pushDisplayState({
        webPreviewPanelOpen: true,
        diffPanelOpen: false,
        runnerPanelOpen: false,
        planPanelOpen: false,
      });
    } else {
      instance.pushDisplayState({ webPreviewPanelOpen: false });
      requestAnimationFrame(() => instance.fit());
    }
  }, [ptyId]);

  const closeWebPreviewPanel = useCallback(() => {
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.webPreviewPanelOpen = false;
    instance.pushDisplayState({ webPreviewPanelOpen: false });
    requestAnimationFrame(() => instance.fit());
  }, [ptyId]);

  const changeWebPreviewUrl = useCallback(
    (newUrl: string) => {
      if (!ptyId) return;
      const instance = terminalInstances.get(ptyId);
      if (!instance) return;
      instance.webPreviewUrl = newUrl;
      instance.pushDisplayState({ webPreviewUrl: newUrl });
    },
    [ptyId],
  );

  return {
    toggleDiffPanel,
    closeDiffPanel,
    toggleRunner,
    collapseRunner,
    killRunner,
    restartRunner,
    togglePlanPanel,
    closePlanPanel,
    changePlanFile,
    toggleWebPreviewPanel,
    closeWebPreviewPanel,
    changeWebPreviewUrl,
  };
}
