/**
 * Renderer process entry point for the Ouijit Electron app
 *
 * This file is automatically loaded by Vite and runs in the renderer context.
 */

import './index.css';
import '@xterm/xterm/css/xterm.css';
import log from 'electron-log/renderer';
import { initIcons } from './utils/icons';
import type { Project, ActiveSession, LastActiveView, HookStatus } from './types';
import { showToast } from './components/importDialog';
import { showNewProjectDialog } from './components/newProjectDialog';
import { initHotkeys } from './utils/hotkeys';
import { enterProjectMode, exitProjectMode, restoreProjectMode, orphanedSessions, homeViewActive, projectRegistry, terminals } from './components/project';
import { projectSessions } from './components/project/state';
import { renderSidebar, wireSidebarClicks, updateSidebarActiveState } from './components/sidebar';
import { enterHomeView, exitHomeView } from './components/homeView';
import { notifyReady, readyBody } from './utils/notifications';
import { addTooltip } from './utils/tooltip';

const rendererLog = log.scope('renderer');

// Store projects for sidebar interactions
let allProjects: Project[] = [];
let appInitialized = false;

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
  // If clicking the already-active project, toggle between kanban and terminals
  const { projectPath } = await import('./components/project');
  if (projectPath.value === path) {
    projectRegistry.toggleKanbanBoard?.();
    return;
  }

  // If in home view, exit it first (returns terminals to hidden containers)
  if (homeViewActive.value) {
    exitHomeView();
  }

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
 * Switch to home view from the sidebar
 */
function handleHomeSelect(): void {
  // If already in home view, do nothing
  if (homeViewActive.value) return;

  enterHomeView();
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
    }
  } catch (error) {
    rendererLog.error('failed to check/restore sessions', { error: error instanceof Error ? error.message : String(error) });
  }

  // Load projects and render sidebar
  try {
    allProjects = await window.api.getProjects();
    renderSidebar(sidebarContainer, allProjects);
  } catch (error) {
    rendererLog.error('failed to load projects', { error: error instanceof Error ? error.message : String(error) });
  }

  // Restore last active view from persisted state
  try {
    const lastViewJson = await window.api.globalSettings.get('lastActiveView');
    if (lastViewJson) {
      const lastView = JSON.parse(lastViewJson) as LastActiveView;
      if (lastView.type === 'project' && lastView.path) {
        const project = allProjects.find(p => p.path === lastView.path);
        if (project) {
          const sessions = orphanedSessions.get(lastView.path);
          if (sessions) {
            orphanedSessions.delete(lastView.path);
            await restoreProjectMode(lastView.path, project, sessions);
          } else {
            await enterProjectMode(lastView.path, project);
          }
          updateSidebarActiveState();
          appInitialized = true;
          return;
        }
        rendererLog.info('last active project not found, falling back to home', { path: lastView.path });
      }
    }
  } catch (error) {
    rendererLog.error('failed to restore last active view', { error: error instanceof Error ? error.message : String(error) });
  }

  // Default to home view
  enterHomeView();
  appInitialized = true;
}

/**
 * Global hook status listener for background project notifications.
 * Registered once at startup, never unregistered.
 *
 * Two responsibilities:
 * 1. Keep `summaryType` in sync for background terminals so home view
 *    always shows the correct status dot when entered.
 * 2. Fire notifyReady() for terminals NOT in the active project.
 */
function registerGlobalHookStatusListener(): void {
  window.api.claudeHooks.onStatus(async (ptyId, status) => {
    // Skip until initialization is complete (sessions not yet populated)
    if (!appInitialized) return;

    // Skip if this ptyId belongs to the active project — project-mode listener handles those
    if (terminals.value.some(t => t.ptyId === ptyId)) return;

    // Keep summaryType in sync for background terminals (all status transitions)
    for (const [, session] of projectSessions) {
      const term = session.terminals.find(t => t.ptyId === ptyId);
      if (term) {
        term.summaryType = status === 'thinking' ? 'thinking' : 'ready';
        break;
      }
    }

    // Only fire notifications for ready transitions
    if (status !== 'ready') return;

    // Confirm Claude was actually working (thinkingCount > 0, not a plain shell)
    try {
      const hookStatus = await window.api.claudeHooks.getStatus(ptyId);
      if (!hookStatus || hookStatus.thinkingCount === 0) return;

      // Find terminal info from preserved project sessions or orphaned sessions
      let termLabel = 'Shell';
      let projectName = 'Ouijit';
      let oscTitle = '';
      let found = false;

      for (const [, session] of projectSessions) {
        const term = session.terminals.find(t => t.ptyId === ptyId);
        if (term) {
          termLabel = term.label;
          projectName = session.projectData.name;
          oscTitle = term.lastOscTitle;
          found = true;
          break;
        }
      }

      // Also check orphanedSessions (sessions not yet reconnected to a project)
      if (!found) {
        for (const [projectPath, sessions] of orphanedSessions) {
          const session = sessions.find(s => s.ptyId === ptyId);
          if (session) {
            termLabel = session.label;
            projectName = allProjects.find(p => p.path === projectPath)?.name ?? projectPath.split('/').pop() ?? 'Ouijit';
            break;
          }
        }
      }

      notifyReady(projectName, readyBody(termLabel, oscTitle));
    } catch (error) {
      rendererLog.error('background hook status check failed', { ptyId, error: error instanceof Error ? error.message : String(error) });
    }
  });
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

  // Set up sidebar home button
  const homeBtn = document.getElementById('sidebar-home-btn');
  if (homeBtn) {
    const homeIcon = homeBtn.querySelector('.sidebar-icon') as HTMLElement;
    if (homeIcon) addTooltip(homeIcon, { text: 'Sessions' });
    homeBtn.addEventListener('click', () => {
      handleHomeSelect();
    });
  }

  // Set up sidebar add button (shows menu with add/new options)
  const addBtn = document.getElementById('sidebar-add-btn');
  if (addBtn) {
    addTooltip(addBtn, { text: 'Add project' });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showSidebarAddMenu(addBtn);
    });
  }

  // Sidebar auto-hide: reveal on left edge hover, hide on mouse leave
  const sidebar = document.getElementById('project-sidebar');
  const trigger = document.getElementById('sidebar-trigger');
  if (sidebar && trigger) {
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;

    const showSidebar = () => {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      sidebar.classList.add('sidebar--visible');
      document.documentElement.style.setProperty('--sidebar-offset', 'var(--sidebar-width)');
    };

    const hideSidebar = () => {
      hideTimeout = setTimeout(() => {
        sidebar.classList.remove('sidebar--visible');
        document.documentElement.style.setProperty('--sidebar-offset', '0px');
      }, 300);
    };

    trigger.addEventListener('mouseenter', showSidebar);
    sidebar.addEventListener('mouseenter', showSidebar);
    sidebar.addEventListener('mouseleave', hideSidebar);

    // Back arrow button to reveal sidebar
    const revealBtn = document.getElementById('sidebar-reveal-btn');
    if (revealBtn) {
      addTooltip(revealBtn, { text: 'Show sidebar', placement: 'bottom' });
      revealBtn.addEventListener('click', showSidebar);
    }
  }

  // Register global hook status listener for background project notifications
  registerGlobalHookStatusListener();

  initialize();

  // Listen for fullscreen state changes
  window.api.onFullscreenChange((isFullscreen) => {
    document.body.classList.toggle('is-fullscreen', isFullscreen);
  });
});
