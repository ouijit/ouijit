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
import { useCanvasStore } from '../stores/canvasStore';
import { OuijitTerminal, terminalInstances } from '../components/terminal/terminalReact';
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
    summary: seed.summary ?? '',
    summaryType: seed.summaryType ?? 'ready',
    worktreeBranch: seed.worktreeBranch ?? null,
    sandboxed: seed.sandboxed ?? false,
  });

  const term = new OuijitTerminal({
    projectPath,
    label: seed.label,
    taskId: seed.taskId,
    sandboxed: seed.sandboxed ?? false,
    worktreeBranch: seed.worktreeBranch,
    ptyId: seed.ptyId,
    initialSummaryType: seed.summaryType ?? 'ready',
  });
  term.openTerminal();
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
        projectStore.setTerminalLayout('stack');
        break;
      case 'settings':
        projectStore.setActivePanel('settings');
        projectStore.setKanbanVisible(false);
        break;
      case 'canvas':
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(false);
        projectStore.setTerminalLayout('canvas');
        if (payload.terminalSeeds) {
          const canvas = useCanvasStore.getState();
          for (const seed of payload.terminalSeeds) {
            canvas.addNode(payload.projectPath, seed.ptyId, seed.canvasPosition);
          }
          if (payload.canvasViewport) {
            canvas.setViewport(payload.projectPath, payload.canvasViewport);
          }
        }
        break;
    }
  });
}
