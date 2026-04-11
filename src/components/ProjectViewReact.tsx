import { useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore, getTerminalIndexByStackPosition, STACK_PAGE_SIZE } from '../stores/terminalStore';
import { useCanvasStore, persistCanvas } from '../stores/canvasStore';
import { TerminalCardStack } from './terminal/TerminalCardStack';
import { TerminalCanvas, syncCanvasWithTerminals } from './canvas/TerminalCanvas';
import { KanbanBoard } from './kanban/KanbanBoard';
import { ProjectSettingsPanel } from './scripts/ProjectSettingsPanel';
import { focusKanbanAddInput } from './kanban/KanbanAddInput';
import {
  addProjectTerminal,
  closeProjectTerminal,
  reconnectOrphanedSessions,
  spawnRunner,
} from './terminal/terminalActions';
import { terminalInstances, refreshAllTerminalGitStatus } from './terminal/terminalReact';

const isMac = navigator.platform.toLowerCase().includes('mac');
const GIT_STATUS_PERIODIC_INTERVAL = 30000;
const EMPTY: string[] = [];

/** Get the currently selected ptyId from the canvas (first selected node). */
function getCanvasSelectedPtyId(projectPath: string): string | undefined {
  const project = useCanvasStore.getState().canvasByProject[projectPath];
  if (!project) return undefined;
  const selected = project.nodes.find((n) => n.selected);
  return selected?.id;
}

/** Get the active ptyId based on the current layout mode. */
function getActivePtyId(projectPath: string): string | undefined {
  const layout = useProjectStore.getState().terminalLayout;
  if (layout === 'canvas') {
    return getCanvasSelectedPtyId(projectPath);
  }
  // Stack mode
  const store = useTerminalStore.getState();
  const terms = store.terminalsByProject[projectPath] ?? [];
  const activeIdx = store.activeIndices[projectPath] ?? 0;
  return terms[activeIdx];
}

export function ProjectView() {
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const projectData = useAppStore((s) => s.activeProjectData);
  const kanbanVisible = useProjectStore((s) => s.kanbanVisible);
  const activePanel = useProjectStore((s) => s.activePanel);
  const terminalLayout = useProjectStore((s) => s.terminalLayout);

  const activeIndex = useTerminalStore((s) => (projectPath ? (s.activeIndices[projectPath] ?? 0) : 0));
  const terminalList = useTerminalStore((s) => (projectPath ? s.terminalsByProject[projectPath] : undefined));
  const terminals = terminalList ?? EMPTY;

  // Keyboard shortcuts for project mode
  useEffect(() => {
    if (!projectPath) return;

    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      // Cmd+I — spawn shell terminal
      if (key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        addProjectTerminal(projectPath);
        const store = useProjectStore.getState();
        store.setActivePanel('terminals');
        store.setKanbanVisible(false);
        return;
      }

      // Cmd+W — close active/selected terminal
      if (key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        const ptyId = getActivePtyId(projectPath);
        if (ptyId) closeProjectTerminal(ptyId);
        return;
      }

      // Cmd+N — show kanban board and focus new task input
      if (key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        const store = useProjectStore.getState();
        store.setActivePanel('terminals');
        store.setKanbanVisible(true);
        requestAnimationFrame(() => focusKanbanAddInput());
        return;
      }

      // Cmd+T — toggle kanban board
      if (key === 't') {
        e.preventDefault();
        e.stopPropagation();
        useProjectStore.getState().toggleKanban();
        return;
      }

      // Cmd+L — toggle terminal layout (stack / canvas)
      if (key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        useProjectStore.getState().toggleTerminalLayout();
        return;
      }

      // Cmd+G / Cmd+Shift+G — group/ungroup (canvas mode only)
      if (key === 'g' && useProjectStore.getState().terminalLayout === 'canvas') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          useCanvasStore.getState().ungroupSelected(projectPath);
        } else {
          useCanvasStore.getState().groupSelected(projectPath);
        }
        persistCanvas(projectPath);
        return;
      }

      // Cmd+P — play or toggle runner for active terminal
      if (key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        const pPtyId = getActivePtyId(projectPath);
        if (pPtyId) {
          const inst = terminalInstances.get(pPtyId);
          if (inst) {
            if (inst.runner?.ptyId) {
              inst.runnerPanelOpen = !inst.runnerPanelOpen;
              if (inst.runnerPanelOpen && inst.diffPanelOpen) {
                inst.diffPanelOpen = false;
                inst.pushDisplayState({ runnerPanelOpen: true, diffPanelOpen: false });
              } else {
                inst.pushDisplayState({ runnerPanelOpen: inst.runnerPanelOpen });
              }
            } else {
              spawnRunner(pPtyId);
            }
            useProjectStore.getState().setKanbanVisible(false);
          }
        }
        return;
      }

      // Cmd+D — toggle diff panel for active terminal
      if (key === 'd') {
        e.preventDefault();
        e.stopPropagation();
        const tPtyId = getActivePtyId(projectPath);
        if (tPtyId) {
          const inst = terminalInstances.get(tPtyId);
          if (inst) {
            inst.diffPanelOpen = !inst.diffPanelOpen;
            inst.pushDisplayState({ diffPanelOpen: inst.diffPanelOpen });
            if (inst.diffPanelOpen) useProjectStore.getState().setKanbanVisible(false);
          }
        }
        return;
      }

      // Cmd+1-9 — switch terminal by position
      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        e.stopPropagation();
        const layout = useProjectStore.getState().terminalLayout;
        if (layout === 'canvas') {
          // Canvas mode: select Nth terminal node
          const terms = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
          const targetIdx = num - 1;
          if (targetIdx < terms.length) {
            const targetPtyId = terms[targetIdx];
            const canvas = useCanvasStore.getState().canvasByProject[projectPath];
            if (canvas) {
              const updatedNodes = canvas.nodes.map((n) => ({
                ...n,
                selected: n.id === targetPtyId,
              }));
              useCanvasStore.getState().loadCanvas(projectPath, { ...canvas, nodes: updatedNodes });
            }
            const inst = terminalInstances.get(targetPtyId);
            if (inst) {
              requestAnimationFrame(() => inst.xterm.focus());
            }
          }
        } else {
          // Stack mode: switch by stack position
          const targetIndex = getTerminalIndexByStackPosition(projectPath, num);
          if (targetIndex !== -1) {
            useTerminalStore.getState().setActiveIndex(projectPath, targetIndex);
          }
        }
        return;
      }

      // Cmd+Shift+Left/Right — page navigation (stack mode only)
      if (e.shiftKey && (key === 'arrowleft' || key === 'arrowright')) {
        const layout = useProjectStore.getState().terminalLayout;
        if (layout === 'stack') {
          e.preventDefault();
          e.stopPropagation();
          const store = useTerminalStore.getState();
          const terms = store.terminalsByProject[projectPath] ?? [];
          const currentIndex = store.activeIndices[projectPath] ?? 0;
          const currentPage = Math.floor(currentIndex / STACK_PAGE_SIZE);
          const totalPages = Math.max(1, Math.ceil(terms.length / STACK_PAGE_SIZE));
          const direction = key === 'arrowleft' ? -1 : 1;
          const targetPage = currentPage + direction;
          if (targetPage >= 0 && targetPage < totalPages) {
            store.setActiveIndex(projectPath, targetPage * STACK_PAGE_SIZE);
          }
        }
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [projectPath]);

  // Reconnect orphaned sessions, or show kanban if none exist
  useEffect(() => {
    if (!projectPath) return;
    const existing = useTerminalStore.getState().terminalsByProject[projectPath];
    if (existing && existing.length > 0) {
      // Terminals already exist — sync canvas to prune any stale persisted nodes
      syncCanvasWithTerminals(projectPath);
      return;
    }

    reconnectOrphanedSessions(projectPath).then(() => {
      // Reconnection is done — terminal list is now final.
      // Sync canvas to prune stale nodes from previous sessions.
      syncCanvasWithTerminals(projectPath);

      // Only show kanban if reconnection didn't restore any terminals
      const reconnected = useTerminalStore.getState().terminalsByProject[projectPath];
      if (!reconnected || reconnected.length === 0) {
        useProjectStore.getState().setKanbanVisible(true);
      }
    });
  }, [projectPath]);

  // Periodic git status refresh
  useEffect(() => {
    if (!projectPath) return;
    const interval = setInterval(() => {
      refreshAllTerminalGitStatus(projectPath);
    }, GIT_STATUS_PERIODIC_INTERVAL);
    return () => clearInterval(interval);
  }, [projectPath]);

  // Hook status: register ongoing listener + seed existing terminals
  useEffect(() => {
    if (!projectPath) return;

    // Ongoing listener for hook status events
    const cleanup = window.api.claudeHooks.onStatus((ptyId, status) => {
      const instance = terminalInstances.get(ptyId);
      if (instance) {
        instance.handleHookStatus(status as 'thinking' | 'ready');
      }
    });

    // Seed existing terminals with current hook status
    const terms = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
    for (const ptyId of terms) {
      const instance = terminalInstances.get(ptyId);
      if (!instance) continue;
      window.api.claudeHooks.getStatus(ptyId).then((hookStatus) => {
        if (hookStatus?.status === 'thinking' && hookStatus.thinkingCount > 0) {
          instance.handleHookStatus('thinking');
        }
      });
    }

    return cleanup;
  }, [projectPath]);

  // Plan detection: register listeners + seed existing terminals
  useEffect(() => {
    if (!projectPath) return;

    // Plan file path captured (Write/Edit to .claude/plans/)
    const cleanupDetected = window.api.plan.onDetected((ptyId, planPath) => {
      const apply = () => {
        const instance = terminalInstances.get(ptyId);
        if (instance) {
          instance.planPath = planPath;
          instance.pushDisplayState({ planPath });
        }
      };
      // Instance may not exist yet if reconnection is in progress
      if (terminalInstances.has(ptyId)) {
        apply();
      } else {
        setTimeout(apply, 500);
      }
    });

    // Plan finalized (ExitPlanMode fired) — auto-open the plan panel
    const cleanupReady = window.api.plan.onReady((ptyId) => {
      const instance = terminalInstances.get(ptyId);
      if (instance?.planPath && !instance.planPanelOpen) {
        instance.planPanelOpen = true;
        instance.diffPanelOpen = false;
        instance.runnerPanelOpen = false;
        instance.pushDisplayState({ planPanelOpen: true, diffPanelOpen: false, runnerPanelOpen: false });
      }
    });

    return () => {
      cleanupDetected();
      cleanupReady();
    };
  }, [projectPath]);

  // Focus active terminal when active index changes (stack mode only)
  useEffect(() => {
    if (!projectPath || terminals.length === 0 || kanbanVisible || terminalLayout !== 'stack') return;
    const ptyId = terminals[activeIndex];
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (instance) {
      requestAnimationFrame(() => {
        instance.fit();
        instance.xterm.focus();
      });
    }
  }, [activeIndex, terminals, projectPath, kanbanVisible, terminalLayout]);

  const handleHideKanban = useCallback(() => {
    useProjectStore.getState().setKanbanVisible(false);
  }, []);

  if (!projectPath || !projectData) {
    return <div className="project-view-empty">No project selected</div>;
  }

  const renderTerminals = () => {
    if (terminalLayout === 'canvas') {
      return <TerminalCanvas projectPath={projectPath} />;
    }
    return <TerminalCardStack projectPath={projectPath} />;
  };

  return (
    <div className="project-view h-full">
      {activePanel === 'settings' ? (
        <ProjectSettingsPanel projectPath={projectPath} />
      ) : (
        <>
          {kanbanVisible && <KanbanBoard projectPath={projectPath} onHide={handleHideKanban} />}
          {!kanbanVisible && renderTerminals()}
        </>
      )}
    </div>
  );
}
