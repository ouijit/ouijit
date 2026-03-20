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
  const fullscreen = useAppStore((s) => s.fullscreen);
  const [showNewProject, setShowNewProject] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Platform and fullscreen body class syncing
  useEffect(() => {
    document.body.classList.add(
      navigator.platform.toLowerCase().includes('mac') ? 'platform-darwin' : 'platform-other',
    );
  }, []);

  useEffect(() => {
    document.body.classList.toggle('is-fullscreen', fullscreen);
  }, [fullscreen]);

  useEffect(() => {
    if (!initialized) return;
    document.body.classList.toggle('project-mode', activeView === 'project');
    document.body.classList.toggle('home-mode', activeView === 'home');
  }, [activeView, initialized]);

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

  return (
    <div className="app-layout">
      <Sidebar
        onProjectSelect={handleProjectSelect}
        onHomeSelect={handleHomeSelect}
        onAddExisting={handleAddExisting}
        onCreateNew={handleCreateNew}
      />
      <div className="app-main">
        <TitleBar />
        <main className="main-content">
          {initialized && activeView === 'home' && <HomeView />}
          {initialized && activeView === 'project' && <ProjectView />}
        </main>
      </div>
      <ToastContainer />
      {showNewProject && <NewProjectDialog onClose={handleNewProjectClose} />}
    </div>
  );
}
