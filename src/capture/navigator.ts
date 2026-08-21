/**
 * Renderer-side capture navigator: listens for `capture:navigate` IPC events
 * from the external driver and reshapes the stores to render a given scene.
 *
 * This is only wired up when `window.api.capture` is present (capture mode).
 * Production builds omit the listener entirely because the preload still
 * exposes it but the main-process route never fires.
 */

import log from 'electron-log/renderer';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore, DEFAULT_DISPLAY_STATE } from '../stores/terminalStore';
import { useCanvasStore, isGroupNode } from '../stores/canvasStore';
import { syncCanvasWithTerminals } from '../stores/canvasSync';
import { useUIStore } from '../stores/uiStore';
import { OuijitTerminal, terminalInstances } from '../components/terminal/terminalReact';
import { legacySandboxProvider } from '../types';
import type { CaptureNavigatePayload, CaptureTerminalSeed } from './types';

const captureLog = log.scope('capture');

function seedTerminal(projectPath: string, seed: CaptureTerminalSeed): void {
  const store = useTerminalStore.getState();
  store.addTerminal(projectPath, seed.ptyId, {
    ...DEFAULT_DISPLAY_STATE,
    ptyId: seed.ptyId,
    projectPath,
    taskId: seed.taskId,
    label: seed.label,
    summaryType: seed.summaryType ?? 'ready',
    worktreeBranch: seed.worktreeBranch ?? null,
    sandboxProvider: legacySandboxProvider(seed.sandboxed),
  });

  const term = new OuijitTerminal({
    projectPath,
    label: seed.label,
    taskId: seed.taskId,
    sandboxProvider: legacySandboxProvider(seed.sandboxed),
    worktreeBranch: seed.worktreeBranch,
    ptyId: seed.ptyId,
    initialSummaryType: seed.summaryType ?? 'ready',
  });
  term.openTerminal();
  if (seed.planPath) {
    term.panelFullWidth = false;
    term.addPlanPanel(seed.planPath, seed.planPanelOpen ?? false);
  }
  terminalInstances.set(seed.ptyId, term);

  if (seed.content) {
    term.xterm.write(seed.content);
  }
}

async function waitForProject(projectPath: string, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = useAppStore.getState().projects.find((p) => p.path === projectPath);
    if (found) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

export function installCaptureNavigator(): void {
  if (!window.api.capture) return;

  window.api.capture.onNavigate(async (payload: CaptureNavigatePayload) => {
    captureLog.info('navigate', { scene: payload.scene });

    // Seed terminal display rows first so kanban cards + stack can render them
    if (payload.terminalSeeds && payload.projectPath) {
      const terminals = useTerminalStore.getState().terminalsByProject[payload.projectPath] ?? [];
      if (terminals.length === 0) {
        for (const seed of payload.terminalSeeds) {
          seedTerminal(payload.projectPath, seed);
        }
      }
    }

    if (!payload.projectPath) {
      captureLog.warn('scene requires projectPath', { scene: payload.scene });
      return;
    }

    const ready = await waitForProject(payload.projectPath);
    if (!ready) {
      captureLog.warn('project never appeared', { path: payload.projectPath });
      return;
    }

    const project = useAppStore.getState().projects.find((p) => p.path === payload.projectPath)!;
    useAppStore.getState().navigateToProject(project.path, project);

    const projectStore = useProjectStore.getState();
    switch (payload.scene) {
      case 'kanban':
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(true);
        break;
      case 'terminal-stack':
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(false);
        // setState, not the store's setters: those write the choice to global
        // settings, and a screenshot fixture must not outlive its own run.
        useUIStore.setState({ preferredLayout: 'stack' });
        break;
      case 'settings':
        projectStore.setActivePanel('settings');
        projectStore.setKanbanVisible(false);
        break;
      case 'canvas':
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(false);
        useUIStore.setState({ canvasEnabled: true, preferredLayout: 'canvas' });
        if (payload.terminalSeeds) {
          const canvas = useCanvasStore.getState();
          canvas.ensureProject(payload.projectPath);
          syncCanvasWithTerminals(payload.projectPath);
          const seeded = new Map(payload.terminalSeeds.map((seed) => [seed.ptyId, seed.canvasPosition]));
          // Re-read: the nodes to place are the ones the sync above just built,
          // which the snapshot `canvas` was taken too early to see.
          const synced = useCanvasStore.getState().canvasByProject[payload.projectPath]?.nodes ?? [];
          canvas.setNodes(
            payload.projectPath,
            synced.map((node) => {
              const position = isGroupNode(node) ? undefined : seeded.get(node.data.ptyId);
              return position ? { ...node, position } : node;
            }),
          );
          if (payload.canvasViewport) {
            canvas.setViewport(payload.projectPath, payload.canvasViewport);
          }
        }
        break;
    }
  });
}
