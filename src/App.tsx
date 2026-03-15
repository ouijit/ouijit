import { useCallback, useEffect } from 'react';
import { useIPCListeners } from './hooks/useIPCListeners';
import { useAppStore } from './stores/appStore';
import { TitleBar } from './components/TitleBarReact';
import { Sidebar } from './components/SidebarReact';
import { HomeView } from './components/HomeViewReact';
import { ProjectView } from './components/ProjectViewReact';
import type { Project } from './types';

export function App() {
  useIPCListeners();

  const activeView = useAppStore((s) => s.activeView);
  const fullscreen = useAppStore((s) => s.fullscreen);

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
    document.body.classList.toggle('project-mode', activeView === 'project');
    document.body.classList.toggle('home-mode', activeView === 'home');
  }, [activeView]);

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

  // Load projects on mount and restore last active view
  useEffect(() => {
    window.api.getProjects().then(async (projects) => {
      useAppStore.getState().setProjects(projects);

      // Restore last active view
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
    });
  }, []);

  // Sidebar callbacks
  const handleProjectSelect = useCallback((path: string, project: Project) => {
    const state = useAppStore.getState();
    // If clicking the already-active project, ignore for now (kanban toggle comes in Phase 4)
    if (state.activeProjectPath === path) return;
    state.navigateToProject(path, project);
    // Persist last active view
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

  const handleCreateNew = useCallback(async () => {
    // TODO: showNewProjectDialog in Phase 5
  }, []);

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
          {activeView === 'home' && <HomeView />}
          {activeView === 'project' && <ProjectView />}
        </main>
      </div>
    </div>
  );
}
