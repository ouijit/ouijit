/**
 * Renderer process entry point for the Ouijit Electron app
 *
 * This file is automatically loaded by Vite and runs in the renderer context.
 */

import './index.css';
import '@xterm/xterm/css/xterm.css';
import { createIcons, Search, FolderOpen, Download, RefreshCw, Plus } from 'lucide';
import type { Project, ElectronAPI } from './types';
import { renderProjects } from './components/projectGrid';
import { setupSearch } from './components/searchBar';
import { showImportDialog, showToast } from './components/importDialog';
import { showNewProjectDialog } from './components/newProjectDialog';

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
 * Refreshes the project list
 */
async function refreshProjects(): Promise<void> {
  const projectGrid = document.getElementById('project-grid');
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;

  if (!projectGrid) return;

  try {
    const projects: Project[] = await window.api.refreshProjects();
    renderProjects(projectGrid, projects, handleOpenProject, handleOpenInFinder);

    if (searchInput) {
      searchInput.value = ''; // Reset search on refresh
      setupSearch(searchInput, projects, projectGrid, handleOpenProject, handleOpenInFinder);
    }
  } catch (error) {
    console.error('Failed to refresh projects:', error);
  }
}

// Expose refreshProjects on window for theatre mode restoration
(window as any).refreshProjects = refreshProjects;

/**
 * Creates the drop overlay element
 */
function createDropOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `
    <div class="drop-overlay-content">
      <svg class="drop-overlay-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <p class="drop-overlay-text">Drop .ouijit file to import</p>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Sets up drag and drop handling for .ouijit files
 */
function setupDragDropImport(): void {
  const overlay = createDropOverlay();
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;

    // Check if it's a file
    if (e.dataTransfer?.types.includes('Files')) {
      overlay.classList.add('drop-overlay--visible');
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;

    if (dragCounter === 0) {
      overlay.classList.remove('drop-overlay--visible');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    overlay.classList.remove('drop-overlay--visible');

    const files = Array.from(e.dataTransfer?.files || []);
    const ouijitFile = files.find(f => f.name.endsWith('.ouijit'));

    if (!ouijitFile) {
      if (files.length > 0) {
        showToast('Please drop a .ouijit file', 'error');
      }
      return;
    }

    // Get the file path using Electron's webUtils
    const filePath = window.electronAPI?.getPathForFile(ouijitFile);
    if (!filePath) {
      showToast('Could not read file path', 'error');
      return;
    }

    // Preview the file
    const preview = await window.api.previewOuijitFile(filePath);

    if (!preview.success || !preview.package) {
      showToast(`Failed to read file: ${preview.error}`, 'error');
      return;
    }

    // Show confirmation dialog
    const confirmed = await showImportDialog(preview.package);

    if (!confirmed) {
      return;
    }

    // Do the import
    const result = await window.api.importOuijitPackage(preview.package.tempDir);

    if (result.success) {
      showToast(`Imported ${preview.package.manifest.name}`, 'success');
      // Refresh project list
      await refreshProjects();
    } else {
      showToast(`Import failed: ${result.error}`, 'error');
    }
  });
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
    renderProjects(projectGrid, projects, handleOpenProject, handleOpenInFinder);

    // Set up search functionality if search input exists
    if (searchInput) {
      setupSearch(searchInput, projects, projectGrid, handleOpenProject, handleOpenInFinder);
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
    icons: { Search, FolderOpen, Download, RefreshCw, Plus },
  });

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
  setupDragDropImport();

  // Listen for fullscreen state changes (for theatre mode layout)
  window.api.onFullscreenChange((isFullscreen) => {
    document.body.classList.toggle('is-fullscreen', isFullscreen);
  });
});
