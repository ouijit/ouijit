import { useCallback, useEffect, useState } from 'react';
import { useIPCListeners } from './hooks/useIPCListeners';
import { useAppStore } from './stores/appStore';
import { TitleBar } from './components/TitleBarReact';
import { Sidebar } from './components/SidebarReact';
import { HomeView } from './components/HomeViewReact';
import { ProjectView } from './components/ProjectViewReact';
import { ToastContainer } from './components/ui/ToastContainer';
import { NewProjectDialog } from './components/dialogs/NewProjectDialog';
import type { Project } from './types';

export function App() {
  useIPCListeners();

  const activeView = useAppStore((s) => s.activeView);
  const [showNewProject, setShowNewProject] = useState(false);
  const [initialized, setInitialized] = useState(false);

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

  // Load projects and restore last active view before rendering content
  useEffect(() => {
    window.api.getProjects().then(async (projects) => {
      useAppStore.getState().setProjects(projects);

      const lastView = await window.api.globalSettings.get('lastActiveView');
      if (lastView) {
        try {
          const parsed = JSON.parse(lastView);
          if (parsed.type === 'project' && parsed.path) {
            const project = projects.find((p) => p.path === parsed.path);
            if (project) {
              // Fetch sandbox status before navigating so button renders instantly
              const limaStatus = await window.api.lima.status(parsed.path);
              useAppStore.getState().setSandboxStatus(limaStatus.available, limaStatus.vmStatus);
              useAppStore.getState().navigateToProject(parsed.path, project);
            }
          }
        } catch {
          /* invalid JSON, stay on home */
        }
      }

      setInitialized(true);
    });
  }, []);

  // Sidebar callbacks
  const handleProjectSelect = useCallback((path: string, project: Project) => {
    const state = useAppStore.getState();
    if (state.activeProjectPath === path) return;
    state.navigateToProject(path, project);
    window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'project', path }));
  }, []);

  const handleHomeSelect = useCallback(() => {
    const state = useAppStore.getState();
    if (state.activeView === 'home') return;
    state.navigateHome();
    window.api.globalSettings.set('lastActiveView', JSON.stringify({ type: 'home' }));
  }, []);

  const handleAddExisting = useCallback(async () => {
    const result = await window.api.showFolderPicker();
    if (!result.canceled && result.filePaths.length > 0) {
      const addResult = await window.api.addProject(result.filePaths[0]);
      if (addResult.success) {
        const projects = await window.api.refreshProjects();
        useAppStore.getState().setProjects(projects);
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TitleBar mode={activeView} />
        <main
          className="flex-1 min-h-0"
          style={
            activeView === 'project' || activeView === 'home'
              ? { padding: 0 }
              : { padding: 'var(--spacing-md) var(--content-padding)' }
          }
        >
          {activeView === 'home' && <HomeView />}
          {activeView === 'project' && <ProjectView />}
        </main>
      </div>
      <ToastContainer />
      {showNewProject && <NewProjectDialog onClose={handleNewProjectClose} />}
    </div>
  );
}
