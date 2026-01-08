/**
 * Renderer process entry point for the Ouijit Electron app
 *
 * This file is automatically loaded by Vite and runs in the renderer context.
 */

import './index.css';
import '@xterm/xterm/css/xterm.css';
import { createIcons, Search, FolderOpen, SquareTerminal } from 'lucide';
import type { Project, RunConfig, ElectronAPI } from './types';
import { renderProjects } from './components/projectGrid';
import { setupSearch } from './components/searchBar';
import { createTerminal, destroyTerminal, hasTerminal } from './components/terminalComponent';

// Declare the global window.api interface
declare global {
  interface Window {
    api: ElectronAPI;
  }
}

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
 * Handles opening a project (fallback - opens in Finder)
 */
async function handleOpenProject(path: string): Promise<void> {
  try {
    await window.api.openProject(path);
  } catch (error) {
    console.error('Failed to open project:', error);
  }
}

/**
 * Handles launching a project with a run config (opens inline terminal)
 */
async function handleLaunchProject(path: string, runConfig: RunConfig, row: HTMLElement): Promise<void> {
  try {
    // Toggle terminal if already open
    if (hasTerminal(path)) {
      destroyTerminal(path);
      row.classList.remove('project-row--has-terminal');
      return;
    }

    // Create inline terminal
    const result = await createTerminal(path, runConfig.command, row);

    if (result.success) {
      row.classList.add('project-row--has-terminal');
    } else {
      console.error('Failed to create terminal:', result.error);
    }
  } catch (error) {
    console.error('Failed to launch project:', error);
  }
}

/**
 * Handles opening project in Finder
 */
async function handleOpenInFinder(path: string): Promise<void> {
  try {
    await window.api.openInFinder(path);
  } catch (error) {
    console.error('Failed to open in Finder:', error);
  }
}

/**
 * Handles opening an interactive terminal at the project root
 */
async function handleOpenTerminal(path: string, row: HTMLElement): Promise<void> {
  try {
    // Toggle terminal if already open
    if (hasTerminal(path)) {
      destroyTerminal(path);
      row.classList.remove('project-row--has-terminal');
      return;
    }

    // Create inline terminal (interactive shell, no command)
    const result = await createTerminal(path, undefined, row);

    if (result.success) {
      row.classList.add('project-row--has-terminal');
    } else {
      console.error('Failed to create terminal:', result.error);
    }
  } catch (error) {
    console.error('Failed to open terminal:', error);
  }
}

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

  // Show loading state
  showLoading(projectGrid);

  try {
    // Fetch projects from the main process
    const projects: Project[] = await window.api.getProjects();

    // Render the projects with all handlers
    renderProjects(projectGrid, projects, handleOpenProject, handleLaunchProject, handleOpenInFinder, handleOpenTerminal);

    // Set up search functionality if search input exists
    if (searchInput) {
      setupSearch(searchInput, projects, projectGrid, handleOpenProject, handleLaunchProject, handleOpenInFinder, handleOpenTerminal);
    }
  } catch (error) {
    console.error('Failed to load projects:', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    showError(projectGrid, message);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  createIcons({
    icons: { Search, FolderOpen, SquareTerminal },
  });

  initialize();
});
