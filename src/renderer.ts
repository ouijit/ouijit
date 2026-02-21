/**
 * Renderer process entry point for the Ouijit Electron app
 *
 * This file is automatically loaded by Vite and runs in the renderer context.
 */

import './index.css';
import '@xterm/xterm/css/xterm.css';
import { initIcons } from './utils/icons';
import type { Project, ElectronAPI, ActiveSession } from './types';
import { renderProjects } from './components/projectGrid';
import { setupSearch } from './components/searchBar';
import { showToast } from './components/importDialog';
import { showNewProjectDialog } from './components/newProjectDialog';
import { initHotkeys } from './utils/hotkeys';
import { restoreProjectMode, orphanedSessions } from './components/project';


/**
 * Shows a loading state in the container
 */
function showLoading(container: HTMLElement): void {
  container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading projects...</p>
    </div>
  `;
}

/**
 * Shows an error state in the container
 */
function showError(container: HTMLElement, message: string): void {
  container.innerHTML = `
    <div class="error-state">
      <p class="error-message">Error loading projects</p>
      <p class="error-details">${message}</p>
    </div>
  `;
}

/**
 * Refreshes the project list
 */
async function refreshProjects(): Promise<void> {
  const projectGrid = document.getElementById('project-grid');
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;

  if (!projectGrid) return;

  try {
    const projects: Project[] = await window.api.refreshProjects();
    renderProjects(projectGrid, projects);

    if (searchInput) {
      searchInput.value = ''; // Reset search on refresh
      setupSearch(searchInput, projects, projectGrid);
    }
  } catch (error) {
    console.error('Failed to refresh projects:', error);
  }
}

// Expose refreshProjects on window for project mode restoration
(window as any).refreshProjects = refreshProjects;

/**
 * Initializes the application
 */
async function initialize(): Promise<void> {
  const projectGrid = document.getElementById('project-grid');
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;

  if (!projectGrid) {
    console.error('Project grid container not found');
    return;
  }

  // Check for active PTY sessions that need reconnection (e.g., after renderer reload)
  try {
    const activeSessions = await window.api.pty.getActiveSessions();
    if (activeSessions.length > 0) {
      console.log('[Renderer] Found active PTY sessions:', activeSessions);

      // Group sessions by project path and store in orphanedSessions map
      // This allows enterProjectMode to restore them when opening any project
      const sessionsByProject = new Map<string, ActiveSession[]>();
      for (const session of activeSessions) {
        const existing = sessionsByProject.get(session.projectPath) || [];
        existing.push(session);
        sessionsByProject.set(session.projectPath, existing);
      }

      // Populate orphanedSessions for ALL projects
      for (const [path, sessions] of sessionsByProject) {
        orphanedSessions.set(path, sessions);
        console.log(`[Renderer] Stored ${sessions.length} orphaned sessions for project:`, path);
      }

      // Pick the project with the most sessions to restore immediately
      // (this was the "active" project when the app refreshed)
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
        // Remove from orphanedSessions since we're restoring it now
        orphanedSessions.delete(bestProjectPath);
        await restoreProjectMode(bestProjectPath, project, bestSessions);
        // Continue to load projects in background - CSS hides them in project mode,
        // but they'll be visible when user exits project mode
      }
    }
  } catch (error) {
    console.error('Failed to check/restore sessions:', error);
    // Continue to normal initialization
  }

  // Show loading state
  showLoading(projectGrid);

  try {
    // Fetch projects from the main process
    const projects: Project[] = await window.api.getProjects();

    // Render the projects
    renderProjects(projectGrid, projects);

    // Set up search functionality if search input exists
    if (searchInput) {
      setupSearch(searchInput, projects, projectGrid);
    }
  } catch (error) {
    console.error('Failed to load projects:', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    showError(projectGrid, message);
  }
}

// Prevent Electron's default drag/drop behavior (navigation)
// This allows specific elements (like terminals) to handle drops
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

  // Set up refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      refreshBtn.setAttribute('disabled', 'true');
      try {
        await refreshProjects();
      } finally {
        refreshBtn.classList.remove('spinning');
        refreshBtn.removeAttribute('disabled');
      }
    });
  }

  // Set up add folder button
  const addFolderBtn = document.getElementById('add-folder-btn');
  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', async () => {
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

  // Set up new project button
  const newProjectBtn = document.getElementById('new-project-btn');
  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', async () => {
      const result = await showNewProjectDialog();
      if (result?.created) {
        await refreshProjects();
        showToast(`Created project: ${result.projectName}`, 'success');
      }
    });
  }

  initialize();

  // Listen for fullscreen state changes (for project mode layout)
  window.api.onFullscreenChange((isFullscreen) => {
    document.body.classList.toggle('is-fullscreen', isFullscreen);
  });
});
