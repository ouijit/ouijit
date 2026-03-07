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

/**
 * Show the sidebar add menu (add existing / create new)
 */
function showSidebarAddMenu(anchor: HTMLElement): void {
  // Remove any existing menu
  document.querySelector('.sidebar-add-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'sidebar-add-menu';

  const addExisting = document.createElement('button');
  addExisting.className = 'sidebar-add-menu-item';
  addExisting.textContent = 'Add existing folder';
  addExisting.addEventListener('click', async () => {
    menu.remove();
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

  const createNew = document.createElement('button');
  createNew.className = 'sidebar-add-menu-item';
  createNew.textContent = 'Create new project';
  createNew.addEventListener('click', async () => {
    menu.remove();
    const result = await showNewProjectDialog();
    if (result?.created) {
      await refreshProjects();
      showToast(`Created project: ${result.projectName}`, 'success');
    }
  });

  menu.appendChild(addExisting);
  menu.appendChild(createNew);
  document.body.appendChild(menu);

  // Position to the right of the anchor
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.right + 8}px`;
  menu.style.top = `${rect.top}px`;

  requestAnimationFrame(() => menu.classList.add('sidebar-add-menu--visible'));

  const dismiss = (ev: MouseEvent) => {
    if (menu.contains(ev.target as Node)) return;
    menu.classList.remove('sidebar-add-menu--visible');
    setTimeout(() => menu.remove(), 100);
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
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

  // Set up sidebar add button (shows menu with add/new options)
  const addBtn = document.getElementById('sidebar-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showSidebarAddMenu(addBtn);
    });
  }

  initialize();

  // Listen for fullscreen state changes
  window.api.onFullscreenChange((isFullscreen) => {
    document.body.classList.toggle('is-fullscreen', isFullscreen);
  });
});
