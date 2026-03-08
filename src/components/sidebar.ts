/**
 * Discord-style project sidebar - vertically stacked project icons
 */

import type { Project } from '../types';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { projectPath, homeViewActive, terminals } from './project/signals';
import { projectSessions } from './project/state';
import { showToast } from './importDialog';

// Mutable project lookup - updated whenever sidebar is re-rendered
let projectMap = new Map<string, Project>();

/** Render all project icons into the sidebar container */
export function renderSidebar(
  container: HTMLElement,
  projects: Project[]
): void {
  // Remove existing project items but keep the add button
  const addBtn = container.querySelector('#sidebar-add-btn');
  container.querySelectorAll('.sidebar-item').forEach(el => el.remove());

  projectMap = new Map(projects.map(p => [p.path, p]));

  for (const project of projects) {
    const item = createSidebarIcon(project);
    // Insert before the add button so it stays at the end
    if (addBtn) {
      container.insertBefore(item, addBtn);
    } else {
      container.appendChild(item);
    }
  }

  updateSidebarActiveState();
}

/** Create a single sidebar icon element */
function createSidebarIcon(project: Project): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'sidebar-item';
  wrapper.dataset.projectPath = project.path;
  wrapper.title = project.name;

  // Active indicator pill (left edge)
  const pill = document.createElement('div');
  pill.className = 'sidebar-pill';
  wrapper.appendChild(pill);

  const icon = document.createElement('div');
  icon.className = 'sidebar-icon';

  if (project.iconDataUrl) {
    const img = document.createElement('img');
    img.src = project.iconDataUrl;
    img.alt = project.name;
    img.className = 'sidebar-icon-image';
    img.draggable = false;
    img.onerror = () => {
      icon.innerHTML = '';
      icon.appendChild(createPlaceholder(project));
    };
    icon.appendChild(img);
  } else {
    icon.appendChild(createPlaceholder(project));
  }

  wrapper.appendChild(icon);
  return wrapper;
}

function createPlaceholder(project: Project): HTMLElement {
  const el = document.createElement('div');
  el.className = 'sidebar-icon-placeholder';
  el.style.backgroundColor = stringToColor(project.name);
  el.textContent = getInitials(project.name);
  return el;
}

/** Update the active state on all sidebar icons based on current projectPath */
export function updateSidebarActiveState(): void {
  const container = document.getElementById('sidebar-projects');
  if (!container) return;

  const activePath = projectPath.value;
  const isHome = homeViewActive.value;

  // Update home icon active state
  const homeBtn = document.getElementById('sidebar-home-btn');
  if (homeBtn) {
    homeBtn.classList.toggle('sidebar-home--active', isHome && activePath === null);
  }

  for (const item of container.children) {
    const el = item as HTMLElement;
    const isActive = !isHome && el.dataset.projectPath === activePath;
    el.classList.toggle('sidebar-item--active', isActive);

    // Session count badge: always show terminal count
    const session = projectSessions.get(el.dataset.projectPath!);
    const count = isActive ? terminals.value.length : (session ? session.terminals.length : 0);
    let badge = el.querySelector('.sidebar-session-badge') as HTMLElement | null;
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sidebar-session-badge';
        el.appendChild(badge);
      }
      badge.textContent = String(count);
    } else if (badge) {
      badge.remove();
    }
  }
}

/** Remove a project from the sidebar by path */
export function removeProjectFromSidebar(path: string): void {
  const container = document.getElementById('sidebar-projects');
  if (!container) return;
  const item = container.querySelector(`[data-project-path="${CSS.escape(path)}"]`);
  if (item) item.remove();
  projectMap.delete(path);
}

/**
 * Wire click handlers on sidebar items (event delegation).
 * Call once — handlers survive re-renders since they're on the container.
 */
export function wireSidebarClicks(
  container: HTMLElement,
  onSelect: (path: string, project: Project) => void
): void {
  container.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.sidebar-item') as HTMLElement | null;
    if (!item) return;
    const path = item.dataset.projectPath;
    if (!path) return;
    const project = projectMap.get(path);
    if (project) onSelect(path, project);
  });

  container.addEventListener('contextmenu', (e) => {
    const item = (e.target as HTMLElement).closest('.sidebar-item') as HTMLElement | null;
    if (!item) return;
    const path = item.dataset.projectPath;
    if (!path) return;
    const project = projectMap.get(path);
    if (project) showSidebarContextMenu(e, project);
  });
}

function showSidebarContextMenu(e: Event, project: Project): void {
  const event = e as MouseEvent;
  event.preventDefault();
  event.stopPropagation();

  // Remove any existing context menu
  document.querySelector('.task-context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  const removeItem = document.createElement('button');
  removeItem.className = 'task-context-menu-item task-context-menu-item--danger';
  removeItem.textContent = 'Remove';
  removeItem.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    menu.remove();
    const result = await window.api.removeProject(project.path);
    if (result.success) {
      removeProjectFromSidebar(project.path);
      showToast(`Removed project: ${project.name}`, 'success');
    } else {
      showToast('Failed to remove project', 'error');
    }
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);

  const menuRect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
  const y = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  requestAnimationFrame(() => menu.classList.add('task-context-menu--visible'));

  const dismiss = (ev: MouseEvent) => {
    if (menu.contains(ev.target as Node)) return;
    menu.classList.remove('task-context-menu--visible');
    setTimeout(() => menu.remove(), 100);
    document.removeEventListener('mousedown', dismiss);
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}
