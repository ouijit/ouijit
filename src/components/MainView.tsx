import { useEffect } from 'react';
import { useAppStore, selectIsCloning, type Selection } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { stackMembers, useTerminalStore } from '../stores/terminalStore';
import { useCanvasStore, persistCanvas } from '../stores/canvasStore';
import { useProjectFlags } from '../stores/experimentalStore';
import { useAnalysisStore } from '../stores/analysisStore';
import { loadProjectConfig, loadScripts } from '../stores/projectDataStore';
import { TerminalCardStack } from './terminal/TerminalCardStack';
import { TerminalCanvas } from './canvas/TerminalCanvas';
import { KanbanBoard } from './kanban/KanbanBoard';
import { ProjectSettingsPanel } from './scripts/ProjectSettingsPanel';
import { PullRequestsPanel } from './github/PullRequestsPanel';
import { AnalysisPanel } from './analysis/AnalysisPanel';
import { StandaloneComposerSheet } from './kanban/StandaloneComposerSheet';
import { GlobalSettingsPanel } from './GlobalSettingsPanel';
import { CloningProjectView } from './CloningProjectView';
import { ProjectSourceList, openAddProject } from './projectSources';
import { RecentTasksPanel } from './RecentTasksPanel';
import { ResumeBanner } from './ResumeBanner';
import { openProjectPage } from './navigation';
import { openTaskComposer } from '../utils/openTaskComposer';
import { useComposerStore } from '../stores/composerStore';
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

/** PR detection and analysis for the project on screen, paused while the window is hidden. */
function useProjectRefresh(projectPath: string | null, github: boolean, analysis: boolean): void {
  useEffect(() => {
    if (!projectPath) return;
    loadProjectConfig(projectPath);
    loadScripts(projectPath);
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      if (github) void detectPullRequestsForProject(projectPath);
      if (analysis) void useAnalysisStore.getState().refresh(projectPath);
    };
    const start = () => {
      if (interval != null || document.hidden) return;
      // Catches a pull request opened while the window was hidden; the service
      // rate-limits, so an alt-tab back costs nothing.
      refresh();
      interval = setInterval(refresh, PROJECT_REFRESH_INTERVAL);
    };
    const stop = () => {
      if (interval != null) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [projectPath, github, analysis]);
}

/** The terminal, project page or empty state the sidebar has picked. */
export function MainView() {
  const selection = useAppStore((s) => s.selection);
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const cloning = useAppStore(selectIsCloning);
  const terminalLayout = useProjectStore((s) => s.terminalLayout);
  const sheetProject = useComposerStore((s) => s.sheetProjectPath) ?? (cloning ? null : projectPath);
  const flags = useProjectFlags(cloning ? null : projectPath);
  const stack = selection.kind === 'terminal' ? selection.stack : '';
  const onCanvas = selection.kind === 'terminal' && projectPath !== null && flags.canvas && terminalLayout === 'canvas';

  useProjectRefresh(cloning ? null : projectPath, flags.github, flags.analysis);

  // The canvas keeps its own selection, so the shortcuts act on that there.
  useTerminalView({
    stack,
    shellPath: () => projectPath ?? window.api.homePath(),
    activeTerminal: onCanvas && projectPath ? () => getCanvasSelectedPtyId(projectPath) : undefined,
    select: onCanvas && projectPath ? (ptyId) => selectCanvasNode(projectPath, ptyId) : undefined,
    onScreen: () =>
      onCanvas && projectPath
        ? (useTerminalStore.getState().terminalsByProject[projectPath] ?? [])
        : stackMembers(useTerminalStore.getState(), stack),
  });

  useViewKeys({
    n: () => {
      if (!projectPath || cloning) return false;
      openTaskComposer();
    },
    t: () => {
      if (!projectPath || cloning) return false;
      void openProjectPage(projectPath, 'board');
    },
    l: () => flags.canvas && useProjectStore.getState().toggleTerminalLayout(),
    g: (e) => {
      if (!projectPath || !onCanvas) return false;
      if (e.shiftKey) useCanvasStore.getState().ungroupSelected(projectPath);
      else useCanvasStore.getState().groupSelected(projectPath);
      persistCanvas(projectPath);
    },
  });

  // Turning a flag off must not leave the user on a page whose way in has just disappeared.
  useEffect(() => {
    if (!flags.canvas && terminalLayout === 'canvas') useProjectStore.getState().setTerminalLayout('stack');
  }, [flags.canvas, terminalLayout]);
  const page = selection.kind === 'page' ? selection.page : null;
  useEffect(() => {
    if (!projectPath || cloning) return;
    if ((page === 'pull-requests' && !flags.tracker) || (page === 'analysis' && !flags.analysis)) {
      useAppStore.getState().openPage(projectPath, 'board');
    }
  }, [projectPath, cloning, page, flags.tracker, flags.analysis]);

  return (
    <div className="h-full">
      {cloning ? (
        <CloningProjectView />
      ) : (
        <Selected selection={selection} projectPath={projectPath} onCanvas={onCanvas} />
      )}
      {sheetProject && <StandaloneComposerSheet projectPath={sheetProject} />}
    </div>
  );
}

function Selected({
  selection,
  projectPath,
  onCanvas,
}: {
  selection: Selection;
  projectPath: string | null;
  onCanvas: boolean;
}) {
  if (selection.kind === 'app-settings') return <GlobalSettingsPanel />;
  if (selection.kind === 'terminal') {
    return onCanvas && projectPath ? (
      <TerminalCanvas projectPath={projectPath} />
    ) : (
      <TerminalCardStack stack={selection.stack} />
    );
  }
  if (selection.kind === 'page' && projectPath) {
    switch (selection.page) {
      case 'board':
        return (
          <KanbanBoard
            projectPath={projectPath}
            onTerminalOpened={() => useAppStore.getState().showProjectTerminals(projectPath)}
          />
        );
      case 'settings':
        return <ProjectSettingsPanel projectPath={projectPath} />;
      case 'pull-requests':
        return <PullRequestsPanel projectPath={projectPath} />;
      case 'analysis':
        return <AnalysisPanel projectPath={projectPath} />;
    }
  }
  return <NothingSelected />;
}

function NothingSelected() {
  const projects = useAppStore((s) => s.projects);
  const homeRecents = useAppStore((s) => s.homeRecents);
  const noProjects = projects.length === 0;
  const noRecents = !noProjects && homeRecents !== null && homeRecents.length === 0;
  const isMac = navigator.platform.toLowerCase().includes('mac');

  return (
    <div
      className="fixed top-[82px] right-4 bottom-4 z-[100] overflow-visible"
      style={{
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        transition: 'left 0.2s ease-out, right 0.25s ease, top 0.2s ease',
      }}
    >
      {noProjects ? (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-6">
          <div className="w-full max-w-[36rem]">
            <ProjectSourceList title="Start a project" onChoose={openAddProject} />
          </div>
        </div>
      ) : noRecents ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary rounded-[14px] border border-dashed border-ink/10"
          style={{ background: 'var(--color-terminal-bg)' }}
        >
          <div className="w-full max-w-[36rem] px-6 empty:hidden">
            <ResumeBanner />
          </div>
          <div className="text-sm">No tasks yet.</div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[13px]">{isMac ? '⌘ I' : '⌃ I'}</span>
            <span>to open a terminal</span>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-6">
          <div className="w-full max-w-[36rem] flex flex-col gap-3 max-h-full min-h-0">
            <ResumeBanner />
            <RecentTasksPanel projects={projects} />
          </div>
        </div>
      )}
    </div>
  );
}
