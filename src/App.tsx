import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useIPCListeners } from './hooks/useIPCListeners';
import { useAppStore } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';
import { useExperimentalStore } from './stores/experimentalStore';
import { TitleBar } from './components/TitleBarReact';
import { Sidebar } from './components/SidebarReact';
import { HomeView } from './components/HomeViewReact';
import { GlobalSettingsPanel } from './components/GlobalSettingsPanel';
import { ProjectView } from './components/ProjectViewReact';
import { ToastContainer } from './components/ui/ToastContainer';
import { NewProjectDialog } from './components/dialogs/NewProjectDialog';
import { WhatsNewDialog } from './components/dialogs/WhatsNewDialog';
import { installCaptureNavigator } from './capture/navigator';
import { hydrateTerminalFont } from './components/terminal/terminalReact';
import { installSessionAutoSave } from './components/terminal/sessionSnapshot';
import { useUIStore } from './stores/uiStore';
import log from 'electron-log/renderer';
import type { Project } from './types';

const appLog = log.scope('app');

class ViewErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    appLog.error('view render crashed', {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center w-full max-w-[28rem]">
            <div className="text-sm text-red-400 font-mono mb-2">View crashed</div>
            <div className="text-xs text-white/50 font-mono break-words">{this.state.error.message}</div>
            <button
              className="mt-4 px-3 py-1.5 text-xs bg-white/10 rounded border border-white/20 text-white/70 hover:bg-white/20"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  useIPCListeners();

  const activeView = useAppStore((s) => s.activeView);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const whatsNew = useAppStore((s) => s.whatsNew);
  const homeActivePanel = useAppStore((s) => s.homeActivePanel);
  const [showNewProject, setShowNewProject] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Hydrate experimental flags whenever the active project changes
  useEffect(() => {
    if (activeProjectPath) {
      useExperimentalStore.getState().loadFor(activeProjectPath);
    }
  }, [activeProjectPath]);

  // Prevent Electron drag/drop navigation
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  // Capture-mode IPC navigator (no-op in production builds)
  useEffect(() => {
    installCaptureNavigator();
  }, []);

  // Hydrate terminal-font cache from global settings before any terminal is constructed.
  useEffect(() => {
    hydrateTerminalFont();
  }, []);

  // Hydrate persisted sidebar-pinned preference.
  useEffect(() => {
    window.api.globalSettings.get('ui:sidebar-pinned').then((value) => {
      if (value === '1') useUIStore.setState({ sidebarPinned: true });
    });
  }, []);

  // Subscribe to terminal store changes so the cross-launch session snapshot
  // stays current. Resume banner reads it on next launch.
  useEffect(() => {
    installSessionAutoSave();
  }, []);

  // First-run marker — set so other surfaces can know whether the user has
  // launched before. The actual welcome UI lives inline in the empty home view.
  useEffect(() => {
    (async () => {
      const seen = await window.api.globalSettings.get('hasSeenWelcome');
      if (seen) return;
      await window.api.globalSettings.set('hasSeenWelcome', '1');
    })();
  }, []);

  // Load projects and restore last active view before rendering content
  useEffect(() => {
    window.api.getProjects().then(async (projects) => {
      useAppStore.getState().setProjects(projects);

      // If we have a session snapshot to resume, force the user to home so
      // the resume banner is the first thing they see — taking them back to
      // their last project view would hide the offer behind the kanban/empty
      // state and force them to navigate manually.
      const pendingSnapshot = await window.api.globalSettings.get('lastSession:snapshot');
      const hasResumable = !!pendingSnapshot && pendingSnapshot.length > 0;

      let restoredToProject = false;
      if (!hasResumable) {
        const lastView = await window.api.globalSettings.get('lastActiveView');
        if (lastView) {
          try {
            const parsed = JSON.parse(lastView);
            if (parsed.type === 'project' && parsed.path) {
              const project = projects.find((p) => p.path === parsed.path);
              if (project) {
                // Pre-fetch sandbox status + tasks before navigating so the
                // first project paint (kanban included) shows correct content.
                const limaStatus = await window.api.lima.status(parsed.path);
                useAppStore.getState().setSandboxStatus(limaStatus.available, limaStatus.vmStatus);
                await useProjectStore.getState().loadTasks(parsed.path);
                useAppStore.getState().navigateToProject(parsed.path, project);
                restoredToProject = true;
              }
            }
          } catch {
            /* invalid JSON, stay on home */
          }
        }
      }

      // If we're landing on home (default or post-resume), pre-warm recents
      // so the "pick up where you left off" surface is populated on first paint.
      if (!restoredToProject) {
        await useAppStore.getState().loadHomeRecents();
      }

      setInitialized(true);
    });
  }, []);

  // Sidebar callbacks. Direction in the view transition reflects the relative
  // position in the sidebar — clicking a project below the current one slides
  // the new view up into place; above slides down. Home is treated as the
  // top of the list.
  //
  // Both handlers pre-fetch the data the new view needs *before* triggering
  // the view transition. The transition snapshots the new DOM synchronously,
  // so any data still loading in a useEffect would be missed by the crossfade
  // and pop in afterwards.
  const handleProjectSelect = useCallback(async (path: string, project: Project) => {
    const state = useAppStore.getState();
    if (state.activeProjectPath === path) return;
    const orderedPaths = state.projects.map((p) => p.path);
    const oldIndex = state.activeView === 'home' ? -1 : orderedPaths.indexOf(state.activeProjectPath ?? '');
    const newIndex = orderedPaths.indexOf(path);
    const direction = newIndex > oldIndex ? 'down' : newIndex < oldIndex ? 'up' : undefined;
    await useProjectStore.getState().loadTasks(path);
    state.navigateToProject(path, project, { direction });
    window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'project', path }));
  }, []);

  const handleHomeSelect = useCallback(async () => {
    const state = useAppStore.getState();
    if (state.activeView === 'home') return;
    await state.loadHomeRecents();
    state.navigateHome({ direction: 'up' });
    window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'home' }));
  }, []);

  const handleAddExisting = useCallback(async () => {
    const result = await window.api.showFolderPicker();
    if (!result.canceled && result.filePaths.length > 0) {
      const addResult = await window.api.addProject(result.filePaths[0]);
      if (addResult.success) {
        const projects = await window.api.refreshProjects();
        useAppStore.getState().setProjects(projects);
      } else if (addResult.error) {
        useProjectStore.getState().addToast(addResult.error, 'error');
      }
    }
  }, []);

  const handleCreateNew = useCallback(() => {
    setShowNewProject(true);
  }, []);

  const handleNewProjectClose = useCallback(
    async (result: { created: boolean; projectName?: string; projectPath?: string } | null) => {
      setShowNewProject(false);
      if (result?.created && result.projectPath) {
        const projects = await window.api.refreshProjects();
        useAppStore.getState().setProjects(projects);
        // Navigate to the new project
        const project = projects.find((p) => p.path === result.projectPath);
        if (project) {
          useAppStore.getState().navigateToProject(result.projectPath, project);
        }
      }
    },
    [],
  );

  if (!initialized) {
    return <div className="flex h-screen overflow-hidden" style={{ visibility: 'hidden' }} />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        onProjectSelect={handleProjectSelect}
        onHomeSelect={handleHomeSelect}
        onAddExisting={handleAddExisting}
        onCreateNew={handleCreateNew}
      />
      <div className="app-content-shell flex-1 flex flex-col min-w-0 overflow-hidden">
        <TitleBar mode={activeView} />
        <main
          className="flex-1 min-h-0"
          style={
            activeView === 'project' || activeView === 'home'
              ? { padding: 0 }
              : { padding: 'var(--spacing-md) var(--content-padding)' }
          }
        >
          <ViewErrorBoundary>
            {activeView === 'home' && (homeActivePanel === 'settings' ? <GlobalSettingsPanel /> : <HomeView />)}
            {activeView === 'project' && <ProjectView />}
          </ViewErrorBoundary>
        </main>
      </div>
      <ToastContainer />
      {showNewProject && <NewProjectDialog onClose={handleNewProjectClose} />}
      {whatsNew && (
        <WhatsNewDialog
          version={whatsNew.version}
          notes={whatsNew.notes}
          onClose={() => useAppStore.getState().setWhatsNew(null)}
        />
      )}
    </div>
  );
}
