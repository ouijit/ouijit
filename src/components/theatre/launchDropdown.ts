/**
 * Launch dropdown for theatre mode - hooks configuration and project actions
 */

import type { ScriptHook, HookType } from '../../types';
import { theatreState } from './state';
import { projectPath, projectData, launchDropdownVisible } from './signals';
import { stringToColor, getInitials } from '../../utils/projectIcon';
import { showToast } from '../importDialog';
import { showHookConfigDialog, type HookConfigDialogOptions } from '../hookConfigDialog';

const HOOK_HINTS: Record<string, string> = {
  start: 'Runs when a new task is created',
  continue: 'Runs when reopening an existing task',
  run: 'Runs when you click the play button',
  cleanup: 'Runs before archiving a task',
};

/**
 * Build the theatre mode header content
 * Note: Git status is now displayed per-terminal on card labels, not in the header
 */
export function buildTheatreHeader(): string {
  const project = projectData.value;
  if (!project) return '';

  const icon = project.iconDataUrl
    ? `<img src="${project.iconDataUrl}" alt="" class="theatre-project-icon" />`
    : `<div class="theatre-project-icon theatre-project-icon--placeholder" style="background-color: ${stringToColor(project.name)}">${getInitials(project.name)}</div>`;

  return `
    <div class="theatre-header-content">
      <button class="theatre-exit-btn" title="Exit theatre mode">
        <i data-lucide="arrow-left"></i>
      </button>
      ${icon}
      <div class="theatre-project-info">
        <span class="theatre-project-name">${project.name}</span>
        <span class="theatre-project-path">${project.path}</span>
      </div>
      <div class="theatre-sandbox-wrapper" style="display: none;">
        <button class="theatre-sandbox-btn" title="Sandbox">
          <i data-lucide="box"></i>
          <i data-lucide="chevron-down" class="theatre-sandbox-caret"></i>
        </button>
      </div>
      <div class="theatre-view-toggle">
        <button class="theatre-view-toggle-btn theatre-view-toggle-btn--active" data-view="stack" title="Terminal stack">
          <i data-lucide="layers"></i>
        </button>
        <button class="theatre-view-toggle-btn" data-view="board" title="Board view">
          <i data-lucide="columns-3"></i>
        </button>
      </div>
      <div class="theatre-launch-wrapper">
        <button class="theatre-scripts-btn" title="Configure scripts">
          <i data-lucide="code"></i>
          <i data-lucide="chevron-down" class="theatre-scripts-caret"></i>
        </button>
      </div>
      <button class="theatre-terminal-btn" title="New terminal">
        <i data-lucide="terminal"></i>
      </button>
      <button class="theatre-newtask-btn" title="New task">
        <i data-lucide="plus"></i>
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
    commandEl.title = hook.command;
    rightSection.appendChild(commandEl);

    const editBtn = document.createElement('button');
    editBtn.className = 'hook-action-btn';
    editBtn.title = `Edit ${label.toLowerCase()}`;
    editBtn.innerHTML = '<i data-lucide="settings"></i>';
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

  hooksContainer.appendChild(buildHookRow('start', 'Start', hooks.start, path));
  hooksContainer.appendChild(buildHookRow('continue', 'Continue', hooks.continue, path));
  hooksContainer.appendChild(buildHookRow('run', 'Run', hooks.run, path, {
    killExistingOnRun: settings.killExistingOnRun,
  }));
  hooksContainer.appendChild(buildHookRow('cleanup', 'Cleanup', hooks.cleanup, path));

  dropdown.appendChild(hooksContainer);
}

/**
 * Show the launch dropdown
 */
export async function showLaunchDropdown(): Promise<void> {
  if (launchDropdownVisible.value) return;

  const wrapper = document.querySelector('.theatre-launch-wrapper');
  if (!wrapper) return;

  // Create dropdown if it doesn't exist
  let dropdown = wrapper.querySelector('.theatre-launch-dropdown') as HTMLElement;
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'theatre-launch-dropdown';
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
    if (!target.closest('.theatre-launch-wrapper')) {
      hideLaunchDropdown();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 0);

  theatreState.launchDropdownCleanup = () => {
    document.removeEventListener('click', handleClickOutside);
  };
}

/**
 * Hide the launch dropdown
 */
export function hideLaunchDropdown(): void {
  if (!launchDropdownVisible.value) return;

  const dropdown = document.querySelector('.theatre-launch-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
    setTimeout(() => dropdown.remove(), 150);
  }

  if (theatreState.launchDropdownCleanup) {
    theatreState.launchDropdownCleanup();
    theatreState.launchDropdownCleanup = null;
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

