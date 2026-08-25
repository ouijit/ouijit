import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useIPCListeners } from './hooks/useIPCListeners';
import { usePaletteShortcut } from './hooks/usePaletteShortcut';
import { useAppStore, selectActiveClone } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';
import { useExperimentalStore } from './stores/experimentalStore';
import { TitleBar } from './components/TitleBarReact';
import { Sidebar } from './components/SidebarReact';
import { HomeView } from './components/HomeViewReact';
import { GlobalSettingsPanel } from './components/GlobalSettingsPanel';
import { ProjectView } from './components/ProjectViewReact';
import { ToastContainer } from './components/ui/ToastContainer';
import { AddProjectDialog, type AddProjectResult, type AddProjectStep } from './components/dialogs/AddProjectDialog';
import { CloningProjectView } from './components/CloningProjectView';
import { ADD_PROJECT_EVENT, type ProjectSourceKind } from './components/projectSources';
import { InitGitRepoDialog } from './components/dialogs/InitGitRepoDialog';
import { WhatsNewDialog } from './components/dialogs/WhatsNewDialog';
import { HelpDialog } from './components/dialogs/HelpDialog';
import { MissingWorktreeDialog } from './components/dialogs/MissingWorktreeDialog';
import { CommandPalette } from './components/CommandPalette';
import { selectProject, selectHome } from './components/navigation';
import { installCaptureNavigator } from './capture/navigator';
import { hydrateTerminalFont } from './components/terminal/terminalReact';
import { hydrateNotificationSettings } from './utils/notifications';
import { installSessionAutoSave } from './components/terminal/sessionSnapshot';
import { installVisitTracker } from './services/visitTracker';
import { useUIStore, hydrateUIPreferences } from './stores/uiStore';
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
            <div className="text-sm text-error font-mono mb-2">View crashed</div>
            <div className="text-xs text-ink/50 font-mono break-words">{this.state.error.message}</div>
            <button
              className="mt-4 px-3 py-1.5 text-xs bg-ink/10 rounded border border-ink/20 text-ink/70 hover:bg-ink/20"
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
  usePaletteShortcut();

  const activeView = useAppStore((s) => s.activeView);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const whatsNew = useAppStore((s) => s.whatsNew);
  const helpDialogOpen = useAppStore((s) => s.helpDialogOpen);
  const homeActivePanel = useAppStore((s) => s.homeActivePanel);
  const [addProjectStep, setAddProjectStep] = useState<AddProjectStep | null>(null);
  const activeClone = useAppStore(selectActiveClone);
  const [gitInitPath, setGitInitPath] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (activeProjectPath && !activeClone) {
      useExperimentalStore.getState().loadFor(activeProjectPath);
    }
  }, [activeProjectPath, activeClone]);

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

  // Hydrate the ready-audio toggle so notifyReady reads it without an async call.
  useEffect(() => {
    hydrateNotificationSettings();
  }, []);

  useEffect(() => {
    void hydrateUIPreferences();
  }, []);

  // Subscribe to terminal store changes so the cross-launch session snapshot
  // stays current. Resume banner reads it on next launch.
  useEffect(() => {
    installSessionAutoSave();
  }, []);

  useEffect(() => installVisitTracker(), []);

  // First-run marker — set so other surfaces can know whether the user has
  // launched before. The actual welcome UI lives inline in the empty home view.
  useEffect(() => {
    (async () => {
      const seen = await window.api.globalSettings.get('hasSeenWelcome');
      if (seen) return;
      await window.api.globalSettings.set('hasSeenWelcome', '1');
    })();
  }, []);

  useEffect(() => {
    window.api.getProjects().then(async (projects) => {
      useAppStore.getState().setProjects(projects);

      // A persisted snapshot only means "force home for the resume banner" on a
      // cold launch, where its PTYs are gone. When those PTYs are still alive
      // the renderer merely reloaded (a refresh): restore the prior view so the
      // user lands exactly where they were and reconnectOrphanedSessions
      // reattaches the terminals. (ResumeBanner uses the same live-PTY check to
      // stay silent in that case.)
      const pendingSnapshot = await window.api.globalSettings.get('lastSession:snapshot');
      const hasResumable = !!pendingSnapshot && pendingSnapshot.length > 0;

      let snapshotPtysAlive = false;
      if (hasResumable) {
        try {
          const snap = JSON.parse(pendingSnapshot) as { terminals?: { ptyId?: string }[] };
          const snapPtyIds = new Set((snap.terminals ?? []).map((t) => t.ptyId).filter(Boolean));
          if (snapPtyIds.size > 0) {
            const live = await window.api.pty.getActiveSessions();
            snapshotPtysAlive = live.some((s) => snapPtyIds.has(s.ptyId));
          }
        } catch {
          /* unparseable snapshot — treat as a cold launch */
        }
      }
      const forceHomeForResume = hasResumable && !snapshotPtysAlive;

      let restoredToProject = false;
      if (!forceHomeForResume) {
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

      // Pre-warm the home recents cache regardless of which view we're
      // restoring to, so a later home click paints from cache instantly.
      // Awaited only when landing on home, to keep the initial home paint
      // populated; for project restores the fetch runs in the background.
      const recentsPromise = useAppStore.getState().loadHomeRecents();
      if (!restoredToProject) {
        await recentsPromise;
      }

      setInitialized(true);
    });
  }, []);

  // Sidebar callbacks — the shared navigation actions, so the sidebar and the
  // command palette can't drift apart.
  const handleProjectSelect = useCallback((path: string, project: Project) => {
    void selectProject(path, project);
  }, []);

  const handleHomeSelect = useCallback(() => {
    selectHome();
  }, []);

  /**
   * Refresh the project list and navigate to the folder that just became a
   * project. `onlyIfActive` is for a project that arrived on its own time: it
   * settles in place for whoever is watching, and never pulls someone back to
   * a project they navigated away from while it was still arriving.
   */
  const finalizeAddedProject = useCallback(async (addedPath: string, onlyIfActive = false) => {
    const projects = await window.api.refreshProjects();
    useAppStore.getState().setProjects(projects);
    const project = projects.find((p) => p.path === addedPath);
    if (!project) return;
    if (onlyIfActive && useAppStore.getState().activeProjectPath !== addedPath) return;
    useAppStore.getState().navigateToProject(addedPath, project);
  }, []);

  const handleAddExisting = useCallback(async () => {
    const result = await window.api.showFolderPicker();
    if (!result.canceled && result.filePaths.length > 0) {
      const addedPath = result.filePaths[0];
      const addResult = await window.api.addProject(addedPath);
      if (addResult.success) {
        await finalizeAddedProject(addedPath);
      } else if (addResult.reason === 'not-a-git-repo') {
        // Recoverable dead-end: offer to `git init` the folder in place.
        setGitInitPath(addedPath);
      } else if (addResult.error) {
        useProjectStore.getState().addToast(addResult.error, 'error');
      }
    }
  }, [finalizeAddedProject]);

  const handleGitInitClose = useCallback(
    async (result: { initialized: boolean; initialCommit: boolean } | null) => {
      const folderPath = gitInitPath;
      setGitInitPath(null);
      if (!result?.initialized || !folderPath) return;
      const addResult = await window.api.addProject(folderPath);
      if (addResult.success) {
        await finalizeAddedProject(folderPath);
      } else if (addResult.error) {
        useProjectStore.getState().addToast(addResult.error, 'error');
      }
    },
    [gitInitPath, finalizeAddedProject],
  );

  const handleAddProject = useCallback(() => setAddProjectStep('choose'), []);

  // A clone has no project row to navigate to yet, so one is stood up from the
  // job. It is replaced by the real project the moment the clone lands.
  const handleCloneSelect = useCallback((projectPath: string) => {
    const job = useAppStore.getState().cloneJobs.find((entry) => entry.projectPath === projectPath);
    if (job) useAppStore.getState().navigateToProject(projectPath, { name: job.name, path: projectPath });
  }, []);

  // Clone progress arrives as pushes; the list is fetched once so a reload
  // mid-clone still shows what is in flight.
  useEffect(() => {
    void window.api.listClones().then((jobs) => useAppStore.getState().setCloneJobs(jobs));
    const stopChanged = window.api.onClonesChanged((jobs) => useAppStore.getState().setCloneJobs(jobs));
    const stopLanded = window.api.onCloneLanded((projectPath) => void finalizeAddedProject(projectPath, true));
    return () => {
      stopChanged();
      stopLanded();
    };
  }, [finalizeAddedProject]);

  const chooseProjectSource = useCallback(
    (kind: ProjectSourceKind) => {
      if (kind === 'add-existing') void handleAddExisting();
      else setAddProjectStep(kind);
    },
    [handleAddExisting],
  );

  useEffect(() => {
    const onAddProject = (e: Event) => chooseProjectSource((e as CustomEvent<ProjectSourceKind>).detail);
    document.addEventListener(ADD_PROJECT_EVENT, onAddProject);
    return () => document.removeEventListener(ADD_PROJECT_EVENT, onAddProject);
  }, [chooseProjectSource]);

  const handleAddProjectClose = useCallback(
    async (result: AddProjectResult | null) => {
      setAddProjectStep(null);
      if (!result) return;
      if (result.kind === 'add-existing') await handleAddExisting();
      else if (result.kind === 'created') await finalizeAddedProject(result.projectPath);
      else handleCloneSelect(result.projectPath);
    },
    [handleAddExisting, finalizeAddedProject, handleCloneSelect],
  );

  if (!initialized) {
    return <div className="flex h-screen overflow-hidden" style={{ visibility: 'hidden' }} />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        onProjectSelect={handleProjectSelect}
        onHomeSelect={handleHomeSelect}
        onAddProject={handleAddProject}
        onCloneSelect={handleCloneSelect}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TitleBar mode={activeView} />
        <main
          className="app-content-main flex-1 min-h-0"
          style={
            activeView === 'project' || activeView === 'home'
              ? { padding: 0 }
              : { padding: 'var(--spacing-md) var(--content-padding)' }
          }
        >
          <ViewErrorBoundary>
            {activeView === 'home' && (homeActivePanel === 'settings' ? <GlobalSettingsPanel /> : <HomeView />)}
            {activeView === 'project' && (activeClone ? <CloningProjectView job={activeClone} /> : <ProjectView />)}
          </ViewErrorBoundary>
        </main>
      </div>
      <ToastContainer />
      {addProjectStep && <AddProjectDialog initialStep={addProjectStep} onClose={handleAddProjectClose} />}
      {gitInitPath && <InitGitRepoDialog folderPath={gitInitPath} onClose={handleGitInitClose} />}
      {whatsNew && (
        <WhatsNewDialog
          version={whatsNew.version}
          notes={whatsNew.notes}
          onClose={() => useAppStore.getState().setWhatsNew(null)}
        />
      )}
      {helpDialogOpen && <HelpDialog onClose={() => useAppStore.getState().setHelpDialogOpen(false)} />}
      <GlobalMissingWorktreeDialog />
      <CommandPalette />
    </div>
  );
}

function GlobalMissingWorktreeDialog() {
  const request = useUIStore((s) => s.missingWorktreeQueue[0]);
  if (!request) return null;
  return (
    <MissingWorktreeDialog
      key={request.id}
      task={request.task}
      branchExists={request.branchExists}
      onClose={(action) => useUIStore.getState().resolveMissingWorktree(request.id, action)}
    />
  );
}
