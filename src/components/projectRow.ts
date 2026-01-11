import type { Project, RunConfig } from '../types';
import { createElement, ChevronDown, Upload, FolderOpen, SquareTerminal } from 'lucide';
import { showToast } from './importDialog';

/**
 * Generate a consistent color from a string (project name)
 */
function stringToColor(str: string): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8B500', '#FF8C00', '#00CED1', '#9370DB', '#3CB371',
    '#FF69B4', '#20B2AA', '#778899', '#B8860B', '#5F9EA0',
  ];

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Get initials from project name (up to 2 characters)
 */
function getInitials(name: string): string {
  const words = name.replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

/**
 * Creates a project icon element (image or placeholder)
 */
function createProjectIcon(project: Project): HTMLElement {
  const iconContainer = document.createElement('div');
  iconContainer.className = 'project-icon';

  if (project.iconDataUrl) {
    const img = document.createElement('img');
    img.src = project.iconDataUrl;
    img.alt = `${project.name} icon`;
    img.className = 'project-icon-image';
    img.onerror = () => {
      // Fallback to placeholder if image fails to load
      iconContainer.innerHTML = '';
      iconContainer.appendChild(createPlaceholderIcon(project));
    };
    iconContainer.appendChild(img);
  } else {
    iconContainer.appendChild(createPlaceholderIcon(project));
  }

  return iconContainer;
}

/**
 * Creates a placeholder icon with initials
 */
function createPlaceholderIcon(project: Project): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'project-icon-placeholder';
  placeholder.style.backgroundColor = stringToColor(project.name);
  placeholder.textContent = getInitials(project.name);
  return placeholder;
}

/**
 * Format a date as a relative time string (e.g., "2 days ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  } else if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  } else if (diffDays < 7) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  } else if (diffWeeks < 4) {
    return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
  } else if (diffMonths < 12) {
    return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
  } else {
    return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
  }
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Creates a launch dropdown menu
 */
function createLaunchDropdown(
  project: Project,
  row: HTMLElement,
  onLaunch: (path: string, runConfig: RunConfig, row: HTMLElement, projectData: Project) => void,
  onOpenFinder: (path: string) => void
): HTMLElement {
  const dropdown = document.createElement('div');
  dropdown.className = 'launch-dropdown';

  const runConfigs = project.runConfigs || [];

  // Add run config options
  runConfigs.forEach((config) => {
    const option = document.createElement('button');
    option.className = 'launch-option';
    option.innerHTML = `
      <span class="launch-option-name">${config.name}</span>
      <span class="launch-option-source">${config.source}</span>
    `;
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      onLaunch(project.path, config, row, project);
      dropdown.classList.remove('visible');
    });
    dropdown.appendChild(option);
  });

  // Divider
  if (runConfigs.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'launch-dropdown-divider';
    dropdown.appendChild(divider);
  }

  // Export option
  const exportOption = document.createElement('button');
  exportOption.className = 'launch-option';
  const exportIcon = createElement(Upload);
  exportIcon.classList.add('launch-option-icon');
  exportOption.appendChild(exportIcon);
  const exportText = document.createElement('span');
  exportText.className = 'launch-option-name';
  exportText.textContent = 'Export as .ouijit';
  exportOption.appendChild(exportText);
  exportOption.addEventListener('click', async (e) => {
    e.stopPropagation();
    dropdown.classList.remove('visible');
    try {
      const result = await window.api.exportProject(project.path);
      if (result.success && result.outputPath) {
        const filename = result.outputPath.split('/').pop();
        showToast(`Exported ${filename}`, 'success');
      } else if (result.error !== 'Cancelled') {
        showToast(`Export failed: ${result.error}`, 'error');
      }
    } catch (error) {
      showToast('Export failed', 'error');
    }
  });
  dropdown.appendChild(exportOption);

  // Open in Finder option
  const finderOption = document.createElement('button');
  finderOption.className = 'launch-option';
  const folderIcon = createElement(FolderOpen);
  folderIcon.classList.add('launch-option-icon');
  finderOption.appendChild(folderIcon);
  const finderText = document.createElement('span');
  finderText.className = 'launch-option-name';
  finderText.textContent = 'Open in Finder';
  finderOption.appendChild(finderText);
  finderOption.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpenFinder(project.path);
    dropdown.classList.remove('visible');
  });
  dropdown.appendChild(finderOption);

  return dropdown;
}

/**
 * Creates a project row DOM element
 */
export function createProjectRow(
  project: Project,
  onOpen: (path: string) => void,
  onLaunch?: (path: string, runConfig: RunConfig, row: HTMLElement, projectData: Project) => void,
  onOpenFinder?: (path: string) => void,
  onOpenTerminal?: (path: string, row: HTMLElement, projectData: Project) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'project-row';

  // Project icon
  const icon = createProjectIcon(project);
  row.appendChild(icon);

  // Project info (name + path)
  const info = document.createElement('div');
  info.className = 'project-info';

  // Project name
  const nameElement = document.createElement('h3');
  nameElement.className = 'project-name';
  nameElement.textContent = project.name;
  nameElement.title = project.name;
  info.appendChild(nameElement);

  // Project path (truncated with full path on hover)
  const pathElement = document.createElement('p');
  pathElement.className = 'project-path';
  pathElement.textContent = project.path;
  pathElement.title = project.path;
  info.appendChild(pathElement);

  row.appendChild(info);

  // Description - always render for grid alignment
  const descriptionElement = document.createElement('p');
  descriptionElement.className = 'project-description';
  if (project.description) {
    descriptionElement.textContent = project.description;
    descriptionElement.title = project.description;
  }
  row.appendChild(descriptionElement);

  // Badges container
  const badgesContainer = document.createElement('div');
  badgesContainer.className = 'badges';

  // Language badge (first for visual priority)
  if (project.language) {
    const languageBadge = document.createElement('span');
    languageBadge.className = 'badge badge-language';
    languageBadge.textContent = project.language;
    badgesContainer.appendChild(languageBadge);
  }

  // Git badge
  if (project.hasGit) {
    const gitBadge = document.createElement('span');
    gitBadge.className = 'badge badge-git';
    gitBadge.textContent = 'Git';
    badgesContainer.appendChild(gitBadge);
  }

  // Claude badge
  if (project.hasClaude) {
    const claudeBadge = document.createElement('span');
    claudeBadge.className = 'badge badge-claude';
    claudeBadge.textContent = 'Claude';
    badgesContainer.appendChild(claudeBadge);
  }

  row.appendChild(badgesContainer);

  // Last modified
  const lastModified = document.createElement('span');
  lastModified.className = 'last-modified';
  const date = project.lastModified instanceof Date
    ? project.lastModified
    : new Date(project.lastModified);
  lastModified.textContent = formatRelativeTime(date);
  row.appendChild(lastModified);

  const hasRunConfigs = project.runConfigs && project.runConfigs.length > 0;

  // Actions container for buttons
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'actions-container';

  // Terminal button
  if (onOpenTerminal) {
    const terminalBtn = document.createElement('button');
    terminalBtn.className = 'btn btn-primary btn-terminal';
    terminalBtn.title = 'Open Terminal';
    terminalBtn.setAttribute('aria-label', 'Open Terminal');

    const terminalIcon = createElement(SquareTerminal);
    terminalBtn.appendChild(terminalIcon);

    terminalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onOpenTerminal(project.path, row, project);
    });

    actionsContainer.appendChild(terminalBtn);
  }

  if (hasRunConfigs && onLaunch && onOpenFinder) {
    // Create launch button with dropdown
    const launchWrapper = document.createElement('div');
    launchWrapper.className = 'launch-wrapper';

    const launchButton = document.createElement('button');
    launchButton.className = 'btn btn-primary btn-launch';

    const primaryConfig = project.runConfigs![0];
    const launchText = document.createElement('span');
    launchText.textContent = 'Launch';
    launchButton.appendChild(launchText);

    const chevron = createElement(ChevronDown);
    chevron.classList.add('dropdown-arrow');
    launchButton.appendChild(chevron);

    const dropdown = createLaunchDropdown(project, row, onLaunch, onOpenFinder);

    launchButton.addEventListener('click', (e) => {
      e.stopPropagation();
      // Toggle dropdown visibility
      const isVisible = dropdown.classList.contains('visible');
      // Close all other dropdowns
      document.querySelectorAll('.launch-dropdown.visible').forEach(d => d.classList.remove('visible'));
      if (!isVisible) {
        dropdown.classList.add('visible');
      }
    });

    launchWrapper.appendChild(launchButton);
    launchWrapper.appendChild(dropdown);
    actionsContainer.appendChild(launchWrapper);

    // Row click launches primary config
    row.addEventListener('click', () => {
      onLaunch(project.path, primaryConfig, row, project);
    });
  } else {
    // Container for open button
    const actionContainer = document.createElement('div');
    actionContainer.className = 'launch-container';

    // Fallback to simple Open button
    const openButton = document.createElement('button');
    openButton.className = 'btn btn-primary';
    openButton.textContent = 'Open';
    openButton.addEventListener('click', (e) => {
      e.stopPropagation();
      onOpen(project.path);
    });
    actionsContainer.appendChild(openButton);

    // Make the whole row clickable
    row.addEventListener('click', () => {
      onOpen(project.path);
    });
  }

  row.appendChild(actionsContainer);

  return row;
}

// Close dropdowns when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.launch-dropdown.visible').forEach(d => d.classList.remove('visible'));
});
