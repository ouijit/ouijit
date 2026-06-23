import { useCallback } from 'react';
import { terminalInstances } from './terminalReact';
import { startRunner, restartRunner as restartRunnerAction } from './terminalActions';
import type { RunnerScript } from '../../types';

/**
 * Panel operations for one terminal. A terminal holds a list of panels
 * (runner/preview/plan/diff) shown as tabs, with one active at a time.
 * Runner/preview/plan support multiple instances; diff is single.
 */
export function useTerminalPanels(ptyId: string | null) {
  const withInstance = useCallback(
    (fn: (instance: NonNullable<ReturnType<typeof terminalInstances.get>>) => void) => {
      if (!ptyId) return;
      const instance = terminalInstances.get(ptyId);
      if (!instance) return;
      fn(instance);
    },
    [ptyId],
  );

  const activatePanel = useCallback(
    (panelId: string) => {
      withInstance((instance) => {
        instance.activatePanel(panelId);
        requestAnimationFrame(() => instance.fit());
      });
    },
    [withInstance],
  );

  const closePanel = useCallback(
    (panelId: string) => {
      withInstance((instance) => {
        instance.closePanel(panelId);
        requestAnimationFrame(() => instance.fit());
      });
    },
    [withInstance],
  );

  const minimizePanel = useCallback(() => {
    withInstance((instance) => {
      instance.deactivatePanel();
      requestAnimationFrame(() => instance.fit());
    });
  }, [withInstance]);

  const setPanelFullWidth = useCallback(
    (fullWidth: boolean) => {
      withInstance((instance) => {
        instance.setPanelFullWidth(fullWidth);
        requestAnimationFrame(() => {
          instance.fit();
          const active = instance.getActivePanel();
          if (active?.kind === 'runner') instance.runnerChildren.get(active.id)?.fit();
        });
      });
    },
    [withInstance],
  );

  const addRunnerPanel = useCallback(
    (script?: RunnerScript) => {
      if (!ptyId) return;
      void startRunner(ptyId, script);
    },
    [ptyId],
  );

  const addWebPreviewPanel = useCallback(
    (url?: string) => {
      withInstance((instance) => {
        instance.addWebPreviewPanel(url ?? null);
        requestAnimationFrame(() => instance.fit());
      });
    },
    [withInstance],
  );

  const addPlanPanel = useCallback(
    (planPath: string) => {
      withInstance((instance) => {
        instance.addPlanPanel(planPath);
        requestAnimationFrame(() => instance.fit());
      });
    },
    [withInstance],
  );

  const changePlanFile = useCallback(
    (panelId: string, newPath: string) => {
      withInstance((instance) => instance.updatePanel(panelId, { planPath: newPath }));
    },
    [withInstance],
  );

  const changeWebPreviewUrl = useCallback(
    (panelId: string, newUrl: string) => {
      // A manual edit locks out future auto-detections for this panel.
      withInstance((instance) => instance.updatePanel(panelId, { url: newUrl, urlAutoDetected: false }));
    },
    [withInstance],
  );

  const restartRunner = useCallback(
    (panelId: string) => {
      if (!ptyId) return;
      void restartRunnerAction(ptyId, panelId);
    },
    [ptyId],
  );

  // Stop the running command but keep the panel (it drops to its "Runner
  // stopped / Restart" state). Closing the panel entirely is the X button.
  const killRunner = useCallback(
    (panelId: string) => {
      withInstance((instance) => {
        instance.killRunnerChild(panelId);
        instance.updatePanel(panelId, { status: 'idle' });
      });
    },
    [withInstance],
  );

  return {
    activatePanel,
    closePanel,
    minimizePanel,
    setPanelFullWidth,
    addRunnerPanel,
    addWebPreviewPanel,
    addPlanPanel,
    changePlanFile,
    changeWebPreviewUrl,
    restartRunner,
    killRunner,
  };
}
