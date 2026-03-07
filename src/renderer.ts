/**
 * Renderer process entry point for the Ouijit Electron app
 *
 * This file is automatically loaded by Vite and runs in the renderer context.
 */

import './index.css';
import '@xterm/xterm/css/xterm.css';
import log from 'electron-log/renderer';
import { initIcons } from './utils/icons';
import type { Project, ActiveSession } from './types';
import { showToast } from './components/importDialog';
import { showNewProjectDialog } from './components/newProjectDialog';
import { initHotkeys } from './utils/hotkeys';
import { enterProjectMode, exitProjectMode, restoreProjectMode, orphanedSessions } from './components/project';
import { renderSidebar, wireSidebarClicks, updateSidebarActiveState } from './components/sidebar';

const rendererLog = log.scope('renderer');

// Store projects for sidebar interactions
let allProjects: Project[] = [];

/**
 * Refreshes the project list and re-renders the sidebar
 */
async function refreshProjects(): Promise<void> {
  try {
    allProjects = await window.api.refreshProjects();
    const sidebarContainer = document.getElementById('sidebar-projects');
    if (sidebarContainer) {
      renderSidebar(sidebarContainer, allProjects);
    }
  } catch (error) {
    rendererLog.error('failed to refresh projects', { error: error instanceof Error ? error.message : String(error) });
  }
}

// Expose refreshProjects on window for project mode restoration
(window as any).refreshProjects = refreshProjects;

/**
 * Switch to a project from the sidebar
 */
async function handleProjectSelect(path: string, project: Project): Promise<void> {
  // If clicking the already-active project, do nothing
  const { projectPath } = await import('./components/project');
  if (projectPath.value === path) return;

  // If another project is active, exit it first (preserves sessions)
  if (projectPath.value !== null) {
    exitProjectMode();
  }

  // Enter the new project
  await enterProjectMode(path, project);

  // Update sidebar active indicator
  updateSidebarActiveState();
}

/**
 * Initializes the application
 */
async function initialize(): Promise<void> {
  const sidebarContainer = document.getElementById('sidebar-projects');
  if (!sidebarContainer) {
    rendererLog.error('sidebar container not found');
    return;
  }

  // Wire click handlers once (event delegation survives re-renders)
  wireSidebarClicks(sidebarContainer, handleProjectSelect);

  // Check for active PTY sessions that need reconnection (e.g., after renderer reload)
  try {
    const activeSessions = await window.api.pty.getActiveSessions();
    if (activeSessions.length > 0) {
      rendererLog.info('found active PTY sessions', { count: activeSessions.length });

      // Group sessions by project path and store in orphanedSessions map
      const sessionsByProject = new Map<string, ActiveSession[]>();
      for (const session of activeSessions) {
        const existing = sessionsByProject.get(session.projectPath) || [];
        existing.push(session);
        sessionsByProject.set(session.projectPath, existing);
      }

      // Populate orphanedSessions for ALL projects
      for (const [path, sessions] of sessionsByProject) {
        orphanedSessions.set(path, sessions);
        rendererLog.info('stored orphaned sessions for project', { path, count: sessions.length });
      }

      // Pick the project with the most sessions to restore immediately
      let bestProjectPath = '';
      let bestSessions: ActiveSession[] = [];
      for (const [path, sessions] of sessionsByProject) {
        if (sessions.length > bestSessions.length) {
          bestProjectPath = path;
          bestSessions = sessions;
        }
      }

      // Get project data and restore project mode for the active project
      const projects = await window.api.getProjects();
      const project = projects.find(p => p.path === bestProjectPath);

      if (project) {
        orphanedSessions.delete(bestProjectPath);
        allProjects = projects;
        renderSidebar(sidebarContainer, allProjects);
        await restoreProjectMode(bestProjectPath, project, bestSessions);
        updateSidebarActiveState();
        return;
      }
    }
  } catch (error) {
    rendererLog.error('failed to check/restore sessions', { error: error instanceof Error ? error.message : String(error) });
  }

  try {
    allProjects = await window.api.getProjects();
    renderSidebar(sidebarContainer, allProjects);
  } catch (error) {
    rendererLog.error('failed to load projects', { error: error instanceof Error ? error.message : String(error) });
  }
}

// Prevent Electron's default drag/drop behavior (navigation)
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Set platform class for CSS platform-specific styling
  const isMac = navigator.platform.toLowerCase().includes('mac');
  document.body.classList.add(isMac ? 'platform-darwin' : 'platform-other');

  // Initialize hotkey system
  initHotkeys();

  // Initialize automatic icon conversion
  initIcons();

  // Set up sidebar add button
  const addBtn = document.getElementById('sidebar-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const result = await window.api.showFolderPicker();
      if (!result.canceled && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0];
        const addResult = await window.api.addProject(folderPath);
        if (addResult.success) {
          await refreshProjects();
          const folderName = folderPath.split('/').pop() || folderPath;
          showToast(`Added project: ${folderName}`, 'success');
        } else {
          showToast(addResult.error || 'Failed to add project', 'error');
        }
      }
    });
  }

  initialize();

  // Listen for fullscreen state changes
  window.api.onFullscreenChange((isFullscreen) => {
    document.body.classList.toggle('is-fullscreen', isFullscreen);
  });
});
