import type { Project, RunConfig } from '../types';
import { filterProjects, renderProjects } from './projectGrid';
import { getOpenTerminalPaths } from './terminalComponent';

/**
 * Creates a debounced version of a function
 */
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Sets up search functionality for the project grid
 */
export function setupSearch(
  input: HTMLInputElement,
  projects: Project[],
  container: HTMLElement,
  onOpen: (path: string) => void,
  onLaunch?: (path: string, runConfig: RunConfig, row: HTMLElement, projectData: Project) => void,
  onOpenFinder?: (path: string) => void,
  onOpenTerminal?: (path: string, row: HTMLElement, projectData: Project) => void
): void {
  const handleSearch = (query: string) => {
    const openTerminalPaths = getOpenTerminalPaths();
    const filteredProjects = filterProjects(projects, query);
    renderProjects(container, filteredProjects, onOpen, onLaunch, onOpenFinder, onOpenTerminal, openTerminalPaths);

    // Update empty state message for search results
    if (filteredProjects.length === 0 && query.trim()) {
      const emptyState = container.querySelector('.empty-state');
      if (emptyState) {
        emptyState.innerHTML = `
          <p class="empty-state-message">No projects match "${query}"</p>
          <p class="empty-state-hint">Try a different search term.</p>
        `;
      }
    }
  };

  // Create debounced search handler (300ms delay)
  const debouncedSearch = debounce(handleSearch, 300);

  // Set up input event listener
  input.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    debouncedSearch(target.value);
  });

  // Handle clearing the search input
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      handleSearch('');
    }
  });
}
