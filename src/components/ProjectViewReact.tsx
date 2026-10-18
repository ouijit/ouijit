import { useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { stackMembers, useTerminalStore } from '../stores/terminalStore';
import { useCanvasStore, persistCanvas } from '../stores/canvasStore';
import { useExperimentalStore } from '../stores/experimentalStore';
import { loadProjectConfig, loadScripts } from '../stores/projectDataStore';
import { TerminalCardStack } from './terminal/TerminalCardStack';
import { TerminalCanvas, syncCanvasWithTerminals } from './canvas/TerminalCanvas';
import { KanbanBoard } from './kanban/KanbanBoard';
import { ProjectSettingsPanel } from './scripts/ProjectSettingsPanel';
import { PullRequestsPanel } from './github/PullRequestsPanel';
import { AnalysisPanel } from './analysis/AnalysisPanel';
import { useAnalysisStore } from '../stores/analysisStore';
import { StandaloneComposerSheet } from './kanban/StandaloneComposerSheet';
import { openTaskComposer } from '../utils/openTaskComposer';
import { reconnectOrphanedSessions } from './terminal/terminalActions';
import { useTerminalView, useViewKeys } from './terminal/terminalShortcuts';
import { terminalInstances } from './terminal/terminalRegistry';
import { detectPullRequestsForProject } from '../services/githubTaskActions';

const PROJECT_REFRESH_INTERVAL = 30000;

/** The first selected node, when the canvas has several selected. */
function getCanvasSelectedPtyId(projectPath: string): string | undefined {
  return useCanvasStore.getState().canvasByProject[projectPath]?.nodes.find((n) => n.selected)?.id;
}

function selectCanvasNode(projectPath: string, ptyId: string): void {
  const canvas = useCanvasStore.getState().canvasByProject[projectPath];
  if (canvas) {
    const nodes = canvas.nodes.map((n) => ({ ...n, selected: n.id === ptyId }));
    useCanvasStore.getState().loadCanvas(projectPath, { ...canvas, nodes });
  }
  const instance = terminalInstances.get(ptyId);
  if (instance) requestAnimationFrame(() => instance.xterm.focus());
}

function showTerminals(): void {
  const store = useProjectStore.getState();
  store.setActivePanel('terminals');
  store.setKanbanVisible(false);
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
  const githubEnabled = useExperimentalStore((s) =>
    projectPath ? (s.flagsByProject[projectPath]?.github ?? false) : false,
  );
  const analysisEnabled = useExperimentalStore((s) =>
    projectPath ? (s.flagsByProject[projectPath]?.analysis ?? false) : false,
  );
  const onCanvas = canvasEnabled && terminalLayout === 'canvas';

  // The canvas keeps its own selection, so the shortcuts act on that there.
  useTerminalView({
    stack: projectPath ?? '',
    shellPath: () => projectPath ?? '',
    activeTerminal: onCanvas && projectPath ? () => getCanvasSelectedPtyId(projectPath) : undefined,
    select: onCanvas && projectPath ? (ptyId) => selectCanvasNode(projectPath, ptyId) : undefined,
    reveal: showTerminals,
    onScreen: () => (projectPath ? stackMembers(useTerminalStore.getState(), projectPath) : []),
  });

  useViewKeys({
    // On the board this focuses the column composer; anywhere else it opens
    // the sheet rather than switching the view.
    n: () => openTaskComposer(),
    t: () => useProjectStore.getState().toggleKanban(),
    l: () => canvasEnabled && useProjectStore.getState().toggleTerminalLayout(),
    g: (e) => {
      if (!projectPath || !onCanvas) return false;
      if (e.shiftKey) useCanvasStore.getState().ungroupSelected(projectPath);
      else useCanvasStore.getState().groupSelected(projectPath);
      persistCanvas(projectPath);
    },
  });

  // Force layout back to stack if the canvas flag gets disabled while active
  useEffect(() => {
    if (!canvasEnabled && terminalLayout === 'canvas') {
      useProjectStore.getState().setTerminalLayout('stack');
    }
  }, [canvasEnabled, terminalLayout]);

  // Same guard for the flagged panels — turning a flag off must not leave the
  // user stranded on a panel whose toggle has just disappeared.
  useEffect(() => {
    const gone = !githubEnabled && activePanel === 'pull-requests';
    if (gone || (!analysisEnabled && activePanel === 'analysis')) {
      useProjectStore.getState().setActivePanel('terminals');
    }
  }, [githubEnabled, analysisEnabled, activePanel]);

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

      const reconnected = useTerminalStore.getState().terminalsByProject[projectPath];
      if (!reconnected || reconnected.length === 0) {
        useProjectStore.getState().setKanbanVisible(true);
      }
    });
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    loadProjectConfig(projectPath);
    loadScripts(projectPath);
  }, [projectPath]);

  // Pauses while the window is hidden so we don't keep spawning subprocesses
  // for a project the user isn't watching.
  useEffect(() => {
    if (!projectPath) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const sweepPullRequests = () => {
      if (githubEnabled) void detectPullRequestsForProject(projectPath);
    };
    const refreshAnalysis = () => {
      if (analysisEnabled) void useAnalysisStore.getState().refresh(projectPath);
    };
    const start = () => {
      if (interval != null || document.hidden) return;
      // Catches a pull request opened while the window was hidden; the service
      // rate-limits, so an alt-tab back costs nothing.
      sweepPullRequests();
      refreshAnalysis();
      interval = setInterval(() => {
        sweepPullRequests();
        refreshAnalysis();
      }, PROJECT_REFRESH_INTERVAL);
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
  }, [projectPath, githubEnabled, analysisEnabled]);

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
      ) : activePanel === 'pull-requests' ? (
        <PullRequestsPanel projectPath={projectPath} />
      ) : activePanel === 'analysis' ? (
        <AnalysisPanel projectPath={projectPath} />
      ) : (
        <>
          {kanbanVisible && <KanbanBoard projectPath={projectPath} onHide={handleHideKanban} />}
          {!kanbanVisible && renderTerminals()}
        </>
      )}
      <StandaloneComposerSheet projectPath={projectPath} />
    </div>
  );
}
