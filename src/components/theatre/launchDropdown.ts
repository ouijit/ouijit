/**
 * Launch dropdown for theatre mode - command selection and project actions
 */

import { createIcons, ChevronDown, Play, Plus, FolderOpen, Star, X, GitBranchPlus } from 'lucide';
import type { RunConfig } from '../../types';
import { theatreState, MAX_THEATRE_TERMINALS } from './state';
import { projectPath, projectData, terminals, launchDropdownVisible } from './signals';
import { getConfigId, mergeRunConfigs } from '../../utils/runConfigs';
import { stringToColor, getInitials } from '../../utils/projectIcon';
import { showToast } from '../importDialog';
import { showCustomCommandDialog } from '../customCommandDialog';
import { addTheatreTerminal } from './terminalCards';

const launchIcons = { ChevronDown, Play, Plus, FolderOpen, Star, X, GitBranchPlus };

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
      <div class="theatre-worktree-wrapper">
        <button class="theatre-worktree-btn" title="Agent Worktrees">
          <i data-lucide="git-branch-plus"></i>
        </button>
      </div>
      <div class="theatre-launch-wrapper">
        <button class="theatre-launch-chevron-btn" title="More commands">
          <i data-lucide="chevron-down"></i>
        </button>
        <button class="theatre-play-btn" title="Run default command">
          <i data-lucide="play"></i>
        </button>
      </div>
      <button class="theatre-exit-btn" title="Exit theatre mode (Esc)">
        <i data-lucide="minimize-2"></i>
      </button>
    </div>
  `;
}

/**
 * Build the launch dropdown content
 */
export async function buildLaunchDropdownContent(dropdown: HTMLElement): Promise<void> {
  const path = projectPath.value;
  const project = projectData.value;
  if (!path || !project) return;

  dropdown.innerHTML = '';

  // Fetch fresh settings
  const settings = await window.api.getProjectSettings(path);
  const allConfigs = mergeRunConfigs(project.runConfigs, settings.customCommands);
  const defaultCommandId = settings.defaultCommandId;

  // Sort default command to top
  if (defaultCommandId) {
    allConfigs.sort((a, b) => {
      const aIsDefault = getConfigId(a) === defaultCommandId;
      const bIsDefault = getConfigId(b) === defaultCommandId;
      if (aIsDefault && !bIsDefault) return -1;
      if (bIsDefault && !aIsDefault) return 1;
      return 0;
    });
  }

  const explicitDefaultExists = defaultCommandId
    ? allConfigs.some(c => getConfigId(c) === defaultCommandId)
    : false;

  // Create scrollable container for command list
  const commandList = document.createElement('div');
  commandList.className = 'launch-dropdown-commands';

  // Add run config options
  allConfigs.forEach((config, index) => {
    const option = document.createElement('button');
    option.className = 'launch-option';

    const configId = getConfigId(config);
    const isExplicitDefault = defaultCommandId === configId;
    const isVisualDefault = explicitDefaultExists
      ? configId === defaultCommandId
      : index === 0;

    // Star button
    const starBtn = document.createElement('span');
    starBtn.className = isVisualDefault ? 'launch-option-star launch-option-star--active' : 'launch-option-star';
    starBtn.title = isVisualDefault ? 'Default command' : 'Set as default';
    starBtn.innerHTML = '<i data-lucide="star"></i>';
    starBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!isExplicitDefault && path) {
        await window.api.setDefaultCommand(path, configId);
        showToast(`Default: ${config.name}`, 'success');
        hideLaunchDropdown();
      }
    });
    option.appendChild(starBtn);

    const nameContainer = document.createElement('span');
    nameContainer.className = 'launch-option-name';
    nameContainer.textContent = config.name;
    option.appendChild(nameContainer);

    const sourceSpan = document.createElement('span');
    sourceSpan.className = 'launch-option-source';
    sourceSpan.textContent = config.source;
    option.appendChild(sourceSpan);

    // Delete button for custom commands
    if (config.isCustom) {
      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'launch-option-delete';
      deleteBtn.title = 'Delete command';
      deleteBtn.innerHTML = '<i data-lucide="x"></i>';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = confirm(`Delete "${config.name}"?`);
        if (confirmed && path) {
          const currentSettings = await window.api.getProjectSettings(path);
          const customCmd = currentSettings.customCommands.find(c => c.name === config.name);
          if (customCmd) {
            await window.api.deleteCustomCommand(path, customCmd.id);
            showToast(`Deleted: ${config.name}`, 'success');
            hideLaunchDropdown();
          }
        }
      });
      option.appendChild(deleteBtn);
    }

    option.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideLaunchDropdown();
      await addTheatreTerminal(config);
    });
    commandList.appendChild(option);
  });

  // Only add command list section if there are commands
  if (allConfigs.length > 0) {
    dropdown.appendChild(commandList);
  }

  // Custom command option
  const customOption = document.createElement('button');
  customOption.className = 'launch-option';
  customOption.innerHTML = '<i data-lucide="plus" class="launch-option-icon"></i>';
  const customText = document.createElement('span');
  customText.className = 'launch-option-name';
  customText.textContent = 'Custom command...';
  customOption.appendChild(customText);
  customOption.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideLaunchDropdown();
    if (path) {
      const result = await showCustomCommandDialog(path, undefined, {
        defaultToDefault: allConfigs.length === 0
      });
      if (result?.saved && result.command) {
        showToast(`Added command: ${result.command.name}`, 'success');
        // Optionally launch the new command
        const newConfig: RunConfig = {
          name: result.command.name,
          command: result.command.command,
          source: 'custom',
          description: result.command.description,
          priority: 0,
          isCustom: true,
        };
        await addTheatreTerminal(newConfig);
      }
    }
  });
  dropdown.appendChild(customOption);

  // Divider
  const divider2 = document.createElement('div');
  divider2.className = 'launch-dropdown-divider';
  dropdown.appendChild(divider2);

  // Open in Finder option
  const finderOption = document.createElement('button');
  finderOption.className = 'launch-option';
  finderOption.innerHTML = '<i data-lucide="folder-open" class="launch-option-icon"></i>';
  const finderText = document.createElement('span');
  finderText.className = 'launch-option-name';
  finderText.textContent = 'Open in Finder';
  finderOption.appendChild(finderText);
  finderOption.addEventListener('click', (e) => {
    e.stopPropagation();
    hideLaunchDropdown();
    if (path) {
      window.api.openInFinder(path);
    }
  });
  dropdown.appendChild(finderOption);

  // Initialize icons
  createIcons({ icons: launchIcons, nodes: [dropdown] });
}

/**
 * Show the launch dropdown
 */
export async function showLaunchDropdown(): Promise<void> {
  if (launchDropdownVisible.value) return;

  const wrapper = document.querySelector('.theatre-launch-wrapper');
  if (!wrapper) return;

  // Check if at max terminals
  if (terminals.value.length >= MAX_THEATRE_TERMINALS) {
    showToast(`Maximum ${MAX_THEATRE_TERMINALS} terminals`, 'info');
    return;
  }

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
 * Run the default command immediately
 */
export async function runDefaultCommand(): Promise<void> {
  const path = projectPath.value;
  const project = projectData.value;
  if (!path || !project) return;

  // Check if at max terminals
  if (terminals.value.length >= MAX_THEATRE_TERMINALS) {
    showToast(`Maximum ${MAX_THEATRE_TERMINALS} terminals`, 'info');
    return;
  }

  // Fetch settings to get default command
  const settings = await window.api.getProjectSettings(path);
  const allConfigs = mergeRunConfigs(project.runConfigs, settings.customCommands);

  if (allConfigs.length === 0) {
    showToast('No commands configured', 'info');
    return;
  }

  // Find default command or use first available
  let defaultConfig = allConfigs[0];
  if (settings.defaultCommandId) {
    const found = allConfigs.find(c => getConfigId(c) === settings.defaultCommandId);
    if (found) {
      defaultConfig = found;
    }
  }

  await addTheatreTerminal(defaultConfig);
}
