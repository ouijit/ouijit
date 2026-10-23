import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useIPCListeners } from './hooks/useIPCListeners';
import { usePaletteShortcut } from './hooks/usePaletteShortcut';
import { useTerminalShortcuts } from './components/terminal/terminalShortcuts';
import { useAppStore, selectIsCloning, type Selection } from './stores/appStore';
import { useProjectStore } from './stores/projectStore';
import { useExperimentalStore } from './stores/experimentalStore';
import { stackMembers, stackOf, useTerminalStore } from './stores/terminalStore';
import { TitleBar } from './components/TitleBarReact';
import { Sidebar } from './components/SidebarReact';
import { MainView } from './components/MainView';
import { ToastContainer } from './components/ui/ToastContainer';
import { AddProjectDialog, type AddProjectResult, type AddProjectStep } from './components/dialogs/AddProjectDialog';
import { ADD_PROJECT_EVENT, type ProjectSourceKind } from './components/projectSources';
import { InitGitRepoDialog } from './components/dialogs/InitGitRepoDialog';
import { WhatsNewDialog } from './components/dialogs/WhatsNewDialog';
import { HelpDialog } from './components/dialogs/HelpDialog';
import { AboutDialog } from './components/dialogs/AboutDialog';
import { MissingWorktreeDialog } from './components/dialogs/MissingWorktreeDialog';
import { HookConfigDialog } from './components/dialogs/HookConfigDialog';
import { GlobalRunHookDialog } from './components/dialogs/GlobalRunHookDialog';
import { CommandPalette } from './components/CommandPalette';
import { openProjectPage } from './components/navigation';
import { installCaptureNavigator } from './capture/navigator';
import { hydrateTerminalFont } from './components/terminal/terminalReact';
import { reconnectOrphanedSessions } from './components/terminal/terminalActions';
import { hydrateNotificationSettings } from './utils/notifications';
import { installSessionAutoSave, rememberSnapshotViews } from './components/terminal/sessionSnapshot';
import { installVisitTracker } from './services/visitTracker';
import { installCliPanelListener } from './services/cliPanelListener';
import { installCliTagListener } from './services/cliTagListener';
import { installCliTerminalListener } from './services/cliTerminalListener';
import { installCliPointListener } from './services/cliPointListener';
import { PointerLayer } from './components/point/PointerLayer';
import { installHookStatusListener } from './services/hookStatusListener';
import { useUIStore, hydrateUIPreferences } from './stores/uiStore';
import log from 'electron-log/renderer';
import type { LastSessionSnapshot, Project } from './types';

const appLog = log.scope('app');

/**
 * What was on screen when the renderer last ran. A terminal that did not
 * survive, or a project since removed, leaves nothing selected.
 */
function restoredSelection(saved: string | undefined, projects: Project[]): Selection | null {
  let view: { type?: string; ptyId?: string; stack?: string; path?: string; page?: string };
  try {
    view = JSON.parse(saved ?? '');
  } catch {
    return null;
  }
  if (view.type === 'terminal') {
    const terminals = useTerminalStore.getState();
    const [front] = view.stack ? stackMembers(terminals, view.stack) : [];
    const display = terminals.displayStates[front ?? view.ptyId ?? ''];
    if (!display) return null;
    return { kind: 'terminal', stack: front ? view.stack! : stackOf(display), projectPath: display.projectPath };
  }
  if (view.type === 'app-settings') return { kind: 'app-settings' };
  const path = view.path;
  if (!path || !projects.some((p) => p.path === path)) return null;
  const pages = ['board', 'settings', 'pull-requests', 'analysis'] as const;
  const page = pages.find((p) => p === view.page) ?? 'board';
  return { kind: 'page', projectPath: path, page };
}

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
  useTerminalShortcuts();

  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const whatsNew = useAppStore((s) => s.whatsNew);
  const aboutVersion = useAppStore((s) => s.aboutVersion);
  const helpDialogOpen = useAppStore((s) => s.helpDialogOpen);
  const [addProjectStep, setAddProjectStep] = useState<AddProjectStep | null>(null);
  const cloning = useAppStore(selectIsCloning);
  const [gitInitPath, setGitInitPath] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (activeProjectPath && !cloning) {
      useExperimentalStore.getState().loadFor(activeProjectPath);
    }
  }, [activeProjectPath, cloning]);

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

  // Subscribe to terminal store changes so the cross-launch session snapshot
  // stays current. Resume banner reads it on next launch.
  useEffect(() => {
    installSessionAutoSave();
  }, []);

  useEffect(() => installVisitTracker(), []);

  useEffect(() => installCliPanelListener(), []);

  useEffect(() => installCliTagListener(), []);

  useEffect(() => installCliTerminalListener(), []);

  useEffect(() => installCliPointListener(), []);

  useEffect(() => installHookStatusListener(), []);

  // First-run marker — set so other surfaces can know whether the user has
  // launched before. The actual welcome UI lives inline in the empty main view.
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

      // A persisted snapshot means "show the resume banner" only on a cold
      // launch, where its PTYs are gone. When those PTYs are still alive the
      // renderer merely reloaded: restore the prior selection so the user lands
      // exactly where they were. (ResumeBanner uses the same live-PTY check to
      // stay silent in that case.)
      const pendingSnapshot = await window.api.globalSettings.get('lastSession:snapshot');
      const hasResumable = !!pendingSnapshot && pendingSnapshot.length > 0;

      let snapshotPtysAlive = false;
      let snapshot: LastSessionSnapshot | null = null;
      if (hasResumable) {
        try {
          snapshot = JSON.parse(pendingSnapshot) as LastSessionSnapshot;
          const snapPtyIds = new Set((snapshot.terminals ?? []).map((t) => t.ptyId).filter(Boolean));
          if (snapPtyIds.size > 0) {
            const live = await window.api.pty.getActiveSessions();
            snapshotPtysAlive = live.some((s) => snapPtyIds.has(s.ptyId));
          }
        } catch {
          /* unparseable snapshot — treat as a cold launch */
        }
      }

      // The sidebar lists every project's tasks and terminals from the first paint.
      await Promise.all([
        useAppStore.getState().loadHomeRecents(),
        hydrateUIPreferences(),
        reconnectOrphanedSessions(),
      ]);

      // As read at launch: the reconnect's saves rewrite the snapshot before views are back.
      if (snapshot && snapshotPtysAlive) rememberSnapshotViews(snapshot);
      if (!hasResumable || snapshotPtysAlive) {
        const restored = restoredSelection(await window.api.globalSettings.get('lastActiveView'), projects);
        if (restored) useAppStore.getState().select(restored);
      }

      setInitialized(true);
    });
  }, []);

  const finalizeAddedProject = useCallback(async (addedPath: string) => {
    const projects = await window.api.refreshProjects();
    useAppStore.getState().setProjects(projects);
    if (projects.some((p) => p.path === addedPath)) await openProjectPage(addedPath, 'board');
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

  const handleCloneSelect = useCallback((projectPath: string) => {
    useAppStore.getState().openPage(projectPath, 'board');
  }, []);

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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TitleBar />
        <main className="flex-1 min-h-0">
          <ViewErrorBoundary>
            <MainView />
          </ViewErrorBoundary>
        </main>
      </div>
      {/* After the title bar: Electron applies drag and no-drag regions in
          document order, and the title bar's drag region runs under the
          sidebar, so placed first it would swallow the sidebar's buttons. */}
      <Sidebar onAddProject={handleAddProject} onCloneSelect={handleCloneSelect} />
      <PointerLayer />
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
      {aboutVersion && (
        <AboutDialog version={aboutVersion} onClose={() => useAppStore.getState().setAboutVersion(null)} />
      )}
      <GlobalRunHookDialog />
      <GlobalMissingWorktreeDialog />
      <GlobalEditorHookDialog />
      <CommandPalette />
    </div>
  );
}

function GlobalEditorHookDialog() {
  const request = useUIStore((s) => s.editorHookQueue[0]);
  if (!request) return null;
  return (
    <HookConfigDialog
      key={request.id}
      projectPath={request.projectPath}
      hookType="editor"
      existingHook={request.existingHook}
      onClose={(hook) => useUIStore.getState().resolveEditorHook(request.id, hook)}
    />
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
