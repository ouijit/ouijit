import type { Project } from '../types';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { formatRelativeTime } from '../utils/formatDate';
import { enterTheatreMode } from './theatre';

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
 * Creates a project row DOM element
 */
export function createProjectRow(project: Project): HTMLElement {
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

  // Click row to enter theatre mode
  row.addEventListener('click', async () => {
    await enterTheatreMode(project.path, project);
  });

  return row;
}
