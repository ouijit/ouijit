/**
 * Launch dropdown for theatre mode - hooks configuration and project actions
 */

import type { RunConfig, ScriptHook, HookType } from '../../types';
import { theatreState, MAX_THEATRE_TERMINALS } from './state';
import { projectPath, projectData, terminals, launchDropdownVisible } from './signals';
import { stringToColor, getInitials } from '../../utils/projectIcon';
import { showToast } from '../importDialog';
import { showHookConfigDialog } from '../hookConfigDialog';
import { addTheatreTerminal, killExistingCommandInstances } from './terminalCards';

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
      ${icon}
      <div class="theatre-project-info">
        <span class="theatre-project-name">${project.name}</span>
        <span class="theatre-project-path">${project.path}</span>
      </div>
      <button class="theatre-terminal-btn" title="New terminal">
        <i data-lucide="terminal"></i>
      </button>
      <button class="theatre-sandbox-btn" title="Sandbox" style="display: none;">
        <i data-lucide="shield"></i>
      </button>
      <div class="theatre-launch-wrapper">
        <button class="theatre-play-btn" title="Run script">
          <i data-lucide="play"></i>
        </button>
        <button class="theatre-launch-chevron-btn" title="Configure scripts">
          <i data-lucide="chevron-down"></i>
        </button>
      </div>
      <button class="theatre-exit-btn" title="Exit theatre mode">
        <i data-lucide="minimize-2"></i>
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
  options?: { killExistingOnRun?: boolean }
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
      const result = await showHookConfigDialog(path, hookType, hook,
        hookType === 'run' ? { killExistingOnRun: options?.killExistingOnRun } : undefined
      );
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
      const result = await showHookConfigDialog(path, hookType, undefined,
        hookType === 'run' ? { killExistingOnRun: options?.killExistingOnRun } : undefined
      );
      if (result?.saved && result.hook) {
        showToast(`${label} configured`, 'success');
      }
    });
    rightSection.appendChild(configureBtn);
  }

  row.appendChild(rightSection);
  return row;
}

/**
 * Run a hook in a terminal
 */
async function runHook(hook: ScriptHook): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  // Check terminal limit
  if (terminals.value.length >= MAX_THEATRE_TERMINALS) {
    showToast(`Maximum ${MAX_THEATRE_TERMINALS} terminals`, 'info');
    return;
  }

  const config: RunConfig = {
    name: hook.name,
    command: hook.command,
    source: 'custom',
    description: hook.description,
    priority: 0,
    isCustom: true,
  };

  // Kill existing instances unless disabled in settings
  const settings = await window.api.getProjectSettings(path);
  if (settings.killExistingOnRun !== false) {
    killExistingCommandInstances(hook.command);
  }

  await addTheatreTerminal(config);
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

  // Divider
  const divider = document.createElement('div');
  divider.className = 'launch-dropdown-divider';
  dropdown.appendChild(divider);

  // Open in file manager option (platform-aware text)
  const finderOption = document.createElement('button');
  finderOption.className = 'launch-option';
  finderOption.innerHTML = '<i data-lucide="folder-open" class="launch-option-icon"></i>';
  const finderText = document.createElement('span');
  finderText.className = 'launch-option-name';
  // Platform-aware label
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const isWin = navigator.platform.toLowerCase().includes('win');
  finderText.textContent = isMac ? 'Open in Finder' : isWin ? 'Open in Explorer' : 'Open in Files';
  finderOption.appendChild(finderText);
  finderOption.addEventListener('click', (e) => {
    e.stopPropagation();
    hideLaunchDropdown();
    if (path) {
      window.api.openInFinder(path);
    }
  });
  dropdown.appendChild(finderOption);
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

/**
 * Run the run hook immediately
 */
export async function runDefaultCommand(): Promise<void> {
  const path = projectPath.value;
  if (!path) return;

  // Check if at max terminals
  if (terminals.value.length >= MAX_THEATRE_TERMINALS) {
    showToast(`Maximum ${MAX_THEATRE_TERMINALS} terminals`, 'info');
    return;
  }

  // Fetch hooks and settings
  const [hooks, settings] = await Promise.all([
    window.api.hooks.get(path),
    window.api.getProjectSettings(path),
  ]);

  if (!hooks.run) {
    // Open config dialog directly when no run hook is set
    const result = await showHookConfigDialog(path, 'run', undefined, {
      killExistingOnRun: settings.killExistingOnRun,
    });
    if (result?.saved && result.hook) {
      showToast('Run script configured', 'success');
      // Run it immediately after configuring
      await runHook(result.hook);
    }
    return;
  }

  await runHook(hooks.run);
}
