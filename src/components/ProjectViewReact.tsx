import { useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore, getTerminalIndexByStackPosition, STACK_PAGE_SIZE } from '../stores/terminalStore';
import { useCanvasStore, persistCanvas } from '../stores/canvasStore';
import { useExperimentalStore } from '../stores/experimentalStore';
import { TerminalCardStack } from './terminal/TerminalCardStack';
import { TerminalCanvas, syncCanvasWithTerminals } from './canvas/TerminalCanvas';
import { KanbanBoard } from './kanban/KanbanBoard';
import { ProjectSettingsPanel } from './scripts/ProjectSettingsPanel';
import { focusKanbanAddInput } from './kanban/KanbanAddInput';
import { RunHookDialog } from './dialogs/RunHookDialog';
import {
  addProjectTerminal,
  closeProjectTerminal,
  reconnectOrphanedSessions,
  startRunner,
} from './terminal/terminalActions';
import { terminalInstances, refreshAllTerminalGitStatus } from './terminal/terminalReact';
import { useHookStatusListener } from '../hooks/useHookStatusListener';
import { useCliPanelListener } from '../hooks/useCliPanelListener';

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
  const canvasEnabled = useExperimentalStore((s) =>
    projectPath ? (s.flagsByProject[projectPath]?.canvas ?? false) : false,
  );

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

      // Cmd+L — toggle terminal layout (stack / canvas) — only when canvas is enabled
      if (key === 'l' && canvasEnabled) {
        e.preventDefault();
        e.stopPropagation();
        useProjectStore.getState().toggleTerminalLayout();
        return;
      }

      // Cmd+G / Cmd+Shift+G — group/ungroup (canvas mode only)
      if (key === 'g' && canvasEnabled && useProjectStore.getState().terminalLayout === 'canvas') {
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
            // Activate an existing runner tab, else start a new runner.
            const runnerPanel = inst.panels.find((p) => p.kind === 'runner');
            if (runnerPanel) {
              inst.activatePanel(runnerPanel.id);
            } else {
              void startRunner(pPtyId);
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
            inst.toggleDiffPanel();
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
  }, [projectPath, canvasEnabled]);

  // Force layout back to stack if the canvas flag gets disabled while active
  useEffect(() => {
    if (!canvasEnabled && terminalLayout === 'canvas') {
      useProjectStore.getState().setTerminalLayout('stack');
    }
  }, [canvasEnabled, terminalLayout]);

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

  // Load project-scoped config (sandbox availability + configured hooks) once.
  // Terminal headers and kanban cards read this from the store instead of each
  // making their own `lima.status` (subprocess spawn) + `hooks.get` IPC calls.
  useEffect(() => {
    if (!projectPath) return;
    useProjectStore.getState().loadProjectConfig(projectPath);
    useProjectStore.getState().loadScripts(projectPath);
  }, [projectPath]);

  // Periodic git status refresh — pauses while the window is hidden so we
  // don't keep spawning git subprocesses for a project the user isn't watching.
  useEffect(() => {
    if (!projectPath) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval != null || document.hidden) return;
      interval = setInterval(() => {
        refreshAllTerminalGitStatus(projectPath);
      }, GIT_STATUS_PERIODIC_INTERVAL);
    };
    const stop = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [projectPath]);

  // Hook status: register ongoing listener + seed existing terminals
  useHookStatusListener(projectPath);

  // CLI panel ops (`ouijit markdown` / `ouijit preview`) → live terminal panels
  useCliPanelListener();

  // Plan detection: register listeners + seed existing terminals
  useEffect(() => {
    if (!projectPath) return;

    // Plan file path captured (Write/Edit to .claude/plans/). Ensure a plan
    // panel exists for it (without stealing focus from the current panel).
    const cleanupDetected = window.api.plan.onDetected((ptyId, planPath) => {
      const apply = () => {
        const instance = terminalInstances.get(ptyId);
        if (instance && !instance.panels.some((p) => p.kind === 'plan' && p.planPath === planPath)) {
          instance.addPlanPanel(planPath, false);
        }
      };
      // Instance may not exist yet if reconnection is in progress
      if (terminalInstances.has(ptyId)) {
        apply();
      } else {
        setTimeout(apply, 500);
      }
    });

    // Plan finalized (ExitPlanMode fired) — surface and activate the plan panel
    const cleanupReady = window.api.plan.onReady((ptyId) => {
      const instance = terminalInstances.get(ptyId);
      if (!instance) return;
      const planPanel = instance.panels.find((p) => p.kind === 'plan');
      if (planPanel) instance.activatePanel(planPanel.id);
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
    if (canvasEnabled && terminalLayout === 'canvas') {
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
      <GlobalRunHookDialog />
    </div>
  );
}

/**
 * Hook prompt rendered at the project-view level so it survives toggling
 * between the kanban board and terminal stack mid-flow. Concurrent hook
 * requests queue up and are presented one at a time as a stepper.
 */
function GlobalRunHookDialog() {
  const queue = useProjectStore((s) => s.runHookQueue);
  const total = useProjectStore((s) => s.runHookQueueTotal);
  const request = queue[0];
  if (!request) return null;
  // Position counts up as the queue drains: total is held fixed so the user
  // sees "Hook 1 of 3" → "Hook 2 of 3" rather than the denominator shrinking.
  const position = total - queue.length + 1;
  return (
    <RunHookDialog
      key={request.id}
      hookType={request.hookType}
      hook={request.hook}
      projectPath={request.projectPath}
      taskName={request.task.name}
      queuePosition={position}
      queueTotal={total}
      onClose={(result) => useProjectStore.getState().resolveRunHookRequest(request.id, result)}
      onRunAll={(result) => useProjectStore.getState().runAllRunHookRequests(result)}
      onSkipAll={() => useProjectStore.getState().skipAllRunHookRequests()}
    />
  );
}
