import type { Project } from '../types';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { formatRelativeTime } from '../utils/formatDate';
import { enterProjectMode } from './project';
import { showToast } from './importDialog';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../utils/hotkeys';

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

  // Badges container (hidden on small screens)
  const badgesContainer = document.createElement('div');
  badgesContainer.className = 'flex flex-nowrap gap-1 justify-start max-md:hidden';

  // Base badge classes
  const badgeBase = 'inline-flex items-center gap-1 px-2 py-1 text-[13px] font-medium rounded-full transition-all duration-150';

  // Language badge (first for visual priority)
  if (project.language) {
    const languageBadge = document.createElement('span');
    languageBadge.className = `${badgeBase} text-(--color-text-secondary) bg-[rgba(128,128,128,0.12)] dark:bg-[rgba(160,160,160,0.15)]`;
    languageBadge.textContent = project.language;
    badgesContainer.appendChild(languageBadge);
  }

  // Git badge
  if (project.hasGit) {
    const gitBadge = document.createElement('span');
    gitBadge.className = `${badgeBase} text-[#C13B22] bg-[rgba(193,59,34,0.12)] dark:text-[#FF8A75] dark:bg-[rgba(255,138,117,0.15)]`;
    gitBadge.textContent = 'Git';
    badgesContainer.appendChild(gitBadge);
  }

  // Claude badge
  if (project.hasClaude) {
    const claudeBadge = document.createElement('span');
    claudeBadge.className = `${badgeBase} text-[#A65D00] bg-[rgba(166,93,0,0.12)] dark:text-[#FFB84D] dark:bg-[rgba(255,184,77,0.15)]`;
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

  // Click row to enter project mode
  row.addEventListener('click', async () => {
    await enterProjectMode(project.path, project);
  });

  // Right-click context menu
  row.addEventListener('contextmenu', (event) => {
    showProjectContextMenu(event, project);
  });

  return row;
}

/**
 * Show a context menu for a project row
 */
function showProjectContextMenu(event: MouseEvent, project: Project): void {
  event.preventDefault();
  event.stopPropagation();

  // Remove any existing context menu
  document.querySelector('.task-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  const removeItem = document.createElement('button');
  removeItem.className = 'task-context-menu-item task-context-menu-item--danger';
  removeItem.textContent = 'Remove';
  removeItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    menu.remove();
    const confirmed = await showRemoveConfirmDialog(project.name);
    if (!confirmed) return;
    const result = await window.api.removeProject(project.path);
    if (result.success) {
      (window as any).refreshProjects();
      showToast(`Removed project: ${project.name}`, 'success');
    } else {
      showToast('Failed to remove project', 'error');
    }
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);

  // Position the menu
  const menuRect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
  const y = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Animate in
  requestAnimationFrame(() => menu.classList.add('task-context-menu--visible'));

  // Dismiss on click outside
  const dismiss = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    menu.classList.remove('task-context-menu--visible');
    setTimeout(() => menu.remove(), 100);
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

/**
 * Show a confirmation dialog for removing a project
 */
function showRemoveConfirmDialog(projectName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '380px';

    dialog.innerHTML = `
      <h2 class="dialog-title">Remove Project?</h2>
      <p class="dialog-text">
        This will remove <strong>${projectName}</strong> from Ouijit. The project folder will not be deleted.
      </p>
      <div class="dialog-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-danger" data-action="remove">Remove</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      dialog.classList.remove('dialog--visible');
      overlay.classList.remove('modal-overlay--visible');
      setTimeout(() => overlay.remove(), 150);
    };

    const handleRemove = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Event listeners
    dialog.querySelector('[data-action="remove"]')?.addEventListener('click', handleRemove);
    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) handleCancel();
    });

    // Set up hotkey scope for modal
    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, handleCancel);

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('dialog--visible');
    });
  });
}
