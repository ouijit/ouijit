import type { Project, RunConfig } from '../types';
import { createProjectRow } from './projectRow';

/**
 * Renders projects to a container element
 */
export function renderProjects(
  container: HTMLElement,
  projects: Project[],
  onOpen: (path: string) => void,
  onLaunch?: (path: string, runConfig: RunConfig, row: HTMLElement) => void,
  onOpenFinder?: (path: string) => void
): void {
  // Clear existing content
  container.innerHTML = '';

  if (projects.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <p class="empty-state-message">No projects found</p>
      <p class="empty-state-hint">Try adjusting your search or add some projects to get started.</p>
    `;
    container.appendChild(emptyState);
    return;
  }

  // Create and append project rows with staggered animation
  projects.forEach((project, index) => {
    const row = createProjectRow(project, onOpen, onLaunch, onOpenFinder);
    row.style.animationDelay = `${index * 50}ms`;
    container.appendChild(row);
  });
}

/**
 * Filters projects by a search query
 * Searches in name, path, description, and language (case-insensitive)
 */
export function filterProjects(projects: Project[], query: string): Project[] {
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) {
    return projects;
  }

  return projects.filter((project) => {
    const searchableFields = [
      project.name,
      project.path,
      project.description || '',
      project.language || '',
    ];

    return searchableFields.some((field) =>
      field.toLowerCase().includes(normalizedQuery)
    );
  });
}
