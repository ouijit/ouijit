/**
 * Launch dropdown for project mode - hooks configuration and project actions
 */

import type { ScriptHook, HookType } from '../../types';
import { projectState } from './state';
import { projectPath, projectData, launchDropdownVisible } from './signals';
import { stringToColor, getInitials } from '../../utils/projectIcon';
import { showToast } from '../importDialog';
import { showHookConfigDialog, type HookConfigDialogOptions } from '../hookConfigDialog';
import { addTooltip } from '../../utils/tooltip';
import { terminalLayout, buildLayoutToggle } from '../terminalLayout';

const HOOK_HINTS: Record<string, string> = {
  start: 'Runs when a task moves from To Do to In Progress',
  continue: 'Runs when reopening an In Progress task',
  run: 'Runs when you click Run',
  review: 'Runs when a task moves to In Review',
  cleanup: 'Runs when a task moves to Done',
  editor: 'Opens the task worktree in your editor',
};

/**
 * Build the project mode header content
 * Note: Git status is now displayed per-terminal on card labels, not in the header
 */
export function buildProjectHeader(): string {
  const project = projectData.value;
  if (!project) return '';

  const icon = project.iconDataUrl
    ? `<img src="${project.iconDataUrl}" alt="" class="project-header-icon" />`
    : `<div class="project-header-icon project-header-icon--placeholder" style="background-color: ${stringToColor(project.name)}">${getInitials(project.name)}</div>`;

  return `
    <div class="project-header-content">
      ${icon}
      <div class="project-header-info">
        <span class="project-header-name">${project.name}</span>
        <span class="project-header-path">${project.path}</span>
      </div>
      <div class="project-view-toggle">
        <button class="project-view-toggle-btn project-view-toggle-btn--active" data-view="board" title="Board view">
          <i data-icon="kanban"></i>
        </button>
        <button class="project-view-toggle-btn" data-view="stack" title="Terminal stack">
          <i data-icon="cards-three"></i>
        </button>
      </div>
      ${buildLayoutToggle(terminalLayout.value)}
      <div class="project-launch-wrapper">
        <button class="project-hooks-btn" title="Scripts">
          <i data-icon="code"></i>
          <i data-icon="caret-down" class="project-hooks-caret"></i>
        </button>
      </div>
      <div class="project-sandbox-wrapper" style="display: none;">
        <button class="project-sandbox-btn" title="Sandbox">
          <i data-icon="cube"></i>
          <i data-icon="caret-down" class="project-sandbox-caret"></i>
        </button>
      </div>
      <button class="project-terminal-btn" title="New terminal">
        <i data-icon="terminal"></i>
      </button>
      <button class="project-newtask-btn" title="New task">
        <i data-icon="plus"></i>
      </button>
    </div>
  `;
}

/**
 * Build a hook row for the dropdown
 */
function buildHookRow(
  hookType: HookType,
  label: string,
  hook: ScriptHook | undefined,
  path: string,
  options?: HookConfigDialogOptions,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'hook-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'hook-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const rightSection = document.createElement('div');
  rightSection.className = 'hook-row-right';

  if (hook) {
    const commandEl = document.createElement('span');
    commandEl.className = 'hook-command';
    commandEl.textContent = hook.command.length > 30
      ? hook.command.substring(0, 27) + '...'
      : hook.command;
    addTooltip(commandEl, { text: hook.command, placement: 'top' });
    rightSection.appendChild(commandEl);

    const editBtn = document.createElement('button');
    editBtn.className = 'hook-action-btn';
    addTooltip(editBtn, { text: `Edit ${label.toLowerCase()}`, placement: 'top' });
    editBtn.innerHTML = '<i data-icon="gear"></i>';
    editBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideLaunchDropdown();
      const result = await showHookConfigDialog(path, hookType, hook, options);
      if (result?.saved && result.hook) {
        showToast(`${label} updated`, 'success');
      }
    });
    rightSection.appendChild(editBtn);
  } else {
    const configureBtn = document.createElement('button');
    configureBtn.className = 'hook-configure-btn';
    configureBtn.textContent = '+ Configure';
    configureBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideLaunchDropdown();
      const result = await showHookConfigDialog(path, hookType, undefined, options);
      if (result?.saved && result.hook) {
        showToast(`${label} configured`, 'success');
      }
    });
    rightSection.appendChild(configureBtn);
  }

  row.appendChild(rightSection);

  const wrapper = document.createElement('div');
  wrapper.className = 'hook-row-wrapper';
  wrapper.appendChild(row);

  const hint = document.createElement('div');
  hint.className = 'hook-hint';
  hint.textContent = HOOK_HINTS[hookType];
  wrapper.appendChild(hint);

  return wrapper;
}

/**
 * Build the launch dropdown content
 */
export async function buildLaunchDropdownContent(dropdown: HTMLElement): Promise<void> {
  const path = projectPath.value;
  const project = projectData.value;
  if (!path || !project) return;

  dropdown.innerHTML = '';

  // Fetch hooks and settings
  const [hooks, settings] = await Promise.all([
    window.api.hooks.get(path),
    window.api.getProjectSettings(path),
  ]);

  // Section header
  const header = document.createElement('div');
  header.className = 'launch-dropdown-header';
  header.textContent = 'Scripts';
  dropdown.appendChild(header);

  // Hook rows
  const hooksContainer = document.createElement('div');
  hooksContainer.className = 'hooks-container';

  hooksContainer.appendChild(buildHookRow('run', 'Run', hooks.run, path, {
    killExistingOnRun: settings.killExistingOnRun,
  }));
  hooksContainer.appendChild(buildHookRow('editor', 'Editor', hooks.editor, path));

  dropdown.appendChild(hooksContainer);
}

/**
 * Show the launch dropdown
 */
export async function showLaunchDropdown(): Promise<void> {
  if (launchDropdownVisible.value) return;

  const wrapper = document.querySelector('.project-launch-wrapper');
  if (!wrapper) return;

  // Create dropdown if it doesn't exist
  let dropdown = wrapper.querySelector('.project-launch-dropdown') as HTMLElement;
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'project-launch-dropdown';
    wrapper.appendChild(dropdown);
  }

  await buildLaunchDropdownContent(dropdown);

  requestAnimationFrame(() => {
    dropdown.classList.add('visible');
  });

  launchDropdownVisible.value = true;

  // Click outside handler
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.project-launch-wrapper')) {
      hideLaunchDropdown();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 0);

  projectState.launchDropdownCleanup = () => {
    document.removeEventListener('click', handleClickOutside);
  };
}

/**
 * Hide the launch dropdown
 */
export function hideLaunchDropdown(): void {
  if (!launchDropdownVisible.value) return;

  const dropdown = document.querySelector('.project-launch-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  if (projectState.launchDropdownCleanup) {
    projectState.launchDropdownCleanup();
    projectState.launchDropdownCleanup = null;
  }

  launchDropdownVisible.value = false;
}

/**
 * Toggle launch dropdown visibility
 */
export function toggleLaunchDropdown(): void {
  if (launchDropdownVisible.value) {
    hideLaunchDropdown();
  } else {
    showLaunchDropdown();
  }
}

