import type { Project } from '../types';

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

  if (project.iconPath) {
    const img = document.createElement('img');
    img.src = `file://${project.iconPath}`;
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
 * Creates a project card DOM element
 */
export function createProjectCard(
  project: Project,
  onOpen: (path: string) => void
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'project-card';

  // Card header with icon and name
  const header = document.createElement('div');
  header.className = 'project-card-header';

  // Project icon
  const icon = createProjectIcon(project);
  header.appendChild(icon);

  // Project info (name + path)
  const info = document.createElement('div');
  info.className = 'project-info';

  // Project name
  const nameElement = document.createElement('h3');
  nameElement.className = 'project-name';
  nameElement.textContent = project.name;
  info.appendChild(nameElement);

  // Project path (truncated with full path on hover)
  const pathElement = document.createElement('p');
  pathElement.className = 'project-path';
  pathElement.textContent = truncate(project.path, 35);
  pathElement.title = project.path;
  info.appendChild(pathElement);

  header.appendChild(info);
  card.appendChild(header);

  // Badges container
  const badgesContainer = document.createElement('div');
  badgesContainer.className = 'badges';

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

  // Language badge
  if (project.language) {
    const languageBadge = document.createElement('span');
    languageBadge.className = 'badge badge-language';
    languageBadge.textContent = project.language;
    badgesContainer.appendChild(languageBadge);
  }

  card.appendChild(badgesContainer);

  // Description (if available)
  if (project.description) {
    const descriptionElement = document.createElement('p');
    descriptionElement.className = 'project-description';
    descriptionElement.textContent = truncate(project.description, 100);
    if (project.description.length > 100) {
      descriptionElement.title = project.description;
    }
    card.appendChild(descriptionElement);
  }

  // Footer with last modified and open button
  const footer = document.createElement('div');
  footer.className = 'project-card-footer';

  // Last modified
  const lastModified = document.createElement('span');
  lastModified.className = 'last-modified';
  const date = project.lastModified instanceof Date
    ? project.lastModified
    : new Date(project.lastModified);
  lastModified.textContent = formatRelativeTime(date);
  footer.appendChild(lastModified);

  // Open button
  const openButton = document.createElement('button');
  openButton.className = 'btn btn-primary';
  openButton.textContent = 'Open';
  openButton.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpen(project.path);
  });
  footer.appendChild(openButton);

  card.appendChild(footer);

  // Make the whole card clickable as well
  card.addEventListener('click', () => {
    onOpen(project.path);
  });

  return card;
}
