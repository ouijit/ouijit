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
import { useUIStore } from '../stores/uiStore';
import { previewTheme } from '../theme/themeManager';
import { isThemePreference } from '../theme/themes';
import { OuijitTerminal, terminalInstances } from '../components/terminal/terminalReact';
import { SNAPSHOT_KEY, suspendSnapshotSaves } from '../components/terminal/sessionSnapshot';
import { legacySandboxProvider, type LastSessionSnapshot, type SnapshotTerminal } from '../types';
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

/** Bring one terminal to the front of the stack so its body actually renders. */
function focusTerminal(projectPath: string, ptyId: string): void {
  const ptyIds = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
  const index = ptyIds.indexOf(ptyId);
  if (index >= 0) useTerminalStore.getState().setActiveIndex(projectPath, index);
}

/** Click a control that only exists after async state settles, polling for it. */
async function clickWhenPresent(selector: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button) {
      button.click();
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  captureLog.warn('control never appeared', { selector });
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

    previewTheme(payload.theme && isThemePreference(payload.theme) ? payload.theme : null);

    // Scenes run in sequence against one renderer, so close what an earlier
    // scene opened before staging the next one.
    useUIStore.getState().setPaletteOpen(false);
    for (const term of terminalInstances.values()) {
      term.setDiffPanelOpen(false);
      term.setPanelFullWidth(false);
    }

    // The resume banner only renders on a home view with no open terminals,
    // reads its snapshot once on mount, and stays hidden if any snapshot PTY is
    // still alive. So stage it explicitly: stop the auto-save (it would
    // overwrite the snapshot as the stores change), drop the seeded terminals,
    // write a snapshot with no ptyIds, and let navigateHome remount the banner.
    if (payload.scene === 'resume') {
      suspendSnapshotSaves();
      if (payload.projectPath) {
        useTerminalStore.getState().clearProject(payload.projectPath);
        if (payload.terminalSeeds) {
          const projectPath = payload.projectPath;
          const snapshot: LastSessionSnapshot = {
            version: 1,
            capturedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
            activeProjectPath: projectPath,
            terminals: payload.terminalSeeds.map(
              (seed, i): SnapshotTerminal => ({
                projectPath,
                taskNumber: seed.taskId,
                worktreePath: null,
                worktreeBranch: seed.worktreeBranch ?? null,
                label: seed.label,
                ordinalInProject: i,
                isActiveInProject: i === 0,
                ui: {},
              }),
            ),
          };
          await window.api.globalSettings.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
        }
      }
      useAppStore.getState().navigateHome();
      await clickWhenPresent('button[aria-label="Show session details"]');
      return;
    }

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
      case 'palette':
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(true);
        useUIStore.getState().setPaletteOpen(true);
        break;
      case 'diff': {
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(false);
        projectStore.setTerminalLayout('stack');
        const target = payload.diffPtyId ?? payload.terminalSeeds?.[0]?.ptyId;
        const term = target ? terminalInstances.get(target) : undefined;
        if (term && target) {
          focusTerminal(payload.projectPath, target);
          term.setDiffPanelOpen(true);
          await clickWhenPresent('button[aria-label="Hide the file list"]');
        }
        break;
      }
      case 'preview': {
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(false);
        projectStore.setTerminalLayout('stack');
        const target = payload.previewPtyId ?? payload.terminalSeeds?.[0]?.ptyId;
        const term = target ? terminalInstances.get(target) : undefined;
        if (term && target && payload.previewUrl) {
          focusTerminal(payload.projectPath, target);
          if (!term.panels.some((p) => p.kind === 'webPreview')) {
            term.addWebPreviewPanel(payload.previewUrl, { activate: true });
          }
        }
        break;
      }
      case 'markdown': {
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(false);
        projectStore.setTerminalLayout('stack');
        const term = [...terminalInstances.values()].find((t) => t.panels.some((p) => p.kind === 'plan'));
        const plan = term?.panels.find((p) => p.kind === 'plan');
        if (term && plan) {
          focusTerminal(payload.projectPath, term.ptyId);
          term.activatePanel(plan.id);
        }
        break;
      }
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
