import type { Project, RunConfig } from '../types';
import { createElement, ChevronDown, Upload, FolderOpen, Plus, Star, X } from 'lucide';
import { showToast } from './importDialog';
import { showCustomCommandDialog } from './customCommandDialog';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { getConfigId, mergeRunConfigs } from '../utils/runConfigs';
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
 * Builds the dropdown content by fetching fresh settings
 * Called each time the dropdown is opened to ensure state is current
 */
async function buildDropdownContent(
  dropdown: HTMLElement,
  project: Project,
  onOpenFinder: (path: string) => void
): Promise<void> {
  // Clear existing dropdown content
  dropdown.innerHTML = '';

  // Fetch fresh settings
  const settings = await window.api.getProjectSettings(project.path);
  const allConfigs = mergeRunConfigs(project.runConfigs, settings.customCommands);
  const defaultCommandId = settings.defaultCommandId;

  // Check if the explicit default still exists in configs
  const explicitDefaultExists = defaultCommandId
    ? allConfigs.some(c => getConfigId(c) === defaultCommandId)
    : false;

  // Add run config options
  allConfigs.forEach((config, index) => {
    const option = document.createElement('button');
    option.className = 'launch-option';

    const configId = getConfigId(config);
    // Check if this is explicitly set as default
    const isExplicitDefault = defaultCommandId === configId;
    // Visual default: explicit default if it exists, otherwise first item
    const isVisualDefault = explicitDefaultExists
      ? configId === defaultCommandId
      : index === 0;

    // Add set-as-default star button on the left
    const starBtn = document.createElement('span');
    starBtn.className = isVisualDefault ? 'launch-option-star launch-option-star--active' : 'launch-option-star';
    starBtn.title = isVisualDefault ? 'Default command' : 'Set as default';
    const starBtnIcon = createElement(Star);
    starBtn.appendChild(starBtnIcon);
    starBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!isExplicitDefault) {
        await window.api.setDefaultCommand(project.path, configId);
        showToast(`Default: ${config.name}`, 'success');
        dropdown.classList.remove('visible');
        // No DOM updates - dropdown rebuilds on next open
      }
    });
    option.appendChild(starBtn);

    // Create name element
    const nameContainer = document.createElement('span');
    nameContainer.className = 'launch-option-name';
    nameContainer.textContent = config.name;
    option.appendChild(nameContainer);

    const sourceSpan = document.createElement('span');
    sourceSpan.className = 'launch-option-source';
    sourceSpan.textContent = config.source;
    option.appendChild(sourceSpan);

    // Add delete button for custom commands
    if (config.isCustom) {
      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'launch-option-delete';
      deleteBtn.title = 'Delete command';
      const deleteIcon = createElement(X);
      deleteBtn.appendChild(deleteIcon);
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = confirm(`Delete "${config.name}"?`);
        if (confirmed) {
          // Find the matching custom command to get its ID
          const currentSettings = await window.api.getProjectSettings(project.path);
          const customCmd = currentSettings.customCommands.find(c => c.name === config.name);
          if (customCmd) {
            await window.api.deleteCustomCommand(project.path, customCmd.id);
            showToast(`Deleted: ${config.name}`, 'success');
            dropdown.classList.remove('visible');
            // No DOM updates - dropdown rebuilds on next open
          }
        }
      });
      option.appendChild(deleteBtn);
    }

    option.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdown.classList.remove('visible');
      // Enter theatre mode with the selected command
      await enterTheatreMode(project.path, project, config);
    });
    dropdown.appendChild(option);
  });

  // Divider before custom command option
  if (allConfigs.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'launch-dropdown-divider';
    dropdown.appendChild(divider);
  }

  // Custom command option
  const customOption = document.createElement('button');
  customOption.className = 'launch-option';
  const plusIcon = createElement(Plus);
  plusIcon.classList.add('launch-option-icon');
  customOption.appendChild(plusIcon);
  const customText = document.createElement('span');
  customText.className = 'launch-option-name';
  customText.textContent = 'Custom command...';
  customOption.appendChild(customText);
  customOption.addEventListener('click', async (e) => {
    e.stopPropagation();
    dropdown.classList.remove('visible');

    const existingCount = allConfigs.length;
    const result = await showCustomCommandDialog(project.path, undefined, {
      defaultToDefault: existingCount === 0
    });

    if (result?.saved && result.command) {
      showToast(`Added command: ${result.command.name}`, 'success');
      // Enter theatre mode with the new command
      const newConfig: RunConfig = {
        name: result.command.name,
        command: result.command.command,
        source: 'custom',
        description: result.command.description,
        priority: 0,
        isCustom: true,
      };
      await enterTheatreMode(project.path, project, newConfig);
    }
  });
  dropdown.appendChild(customOption);

  // Divider
  const divider2 = document.createElement('div');
  divider2.className = 'launch-dropdown-divider';
  dropdown.appendChild(divider2);

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
    } catch {
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
}

/**
 * Creates a project row DOM element
 */
export function createProjectRow(
  project: Project,
  onOpen: (path: string) => void,
  onOpenFinder?: (path: string) => void
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

  // Actions container for buttons
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'actions-container';

  if (onOpenFinder) {
    // Create launch button with dropdown
    const launchWrapper = document.createElement('div');
    launchWrapper.className = 'launch-wrapper';

    const launchButton = document.createElement('button');
    launchButton.className = 'btn btn-primary btn-launch';

    const launchText = document.createElement('span');
    launchText.textContent = 'Open';
    launchButton.appendChild(launchText);

    const chevron = createElement(ChevronDown);
    chevron.classList.add('dropdown-arrow');
    launchButton.appendChild(chevron);

    // Create empty dropdown container - content built on open
    const dropdown = document.createElement('div');
    dropdown.className = 'launch-dropdown';

    // Lazy load dropdown content when button is clicked
    launchButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isVisible = dropdown.classList.contains('visible');
      // Close all other dropdowns
      document.querySelectorAll('.launch-dropdown.visible').forEach(d => d.classList.remove('visible'));

      if (!isVisible) {
        // Build fresh content before showing
        await buildDropdownContent(dropdown, project, onOpenFinder);
        dropdown.classList.add('visible');
      }
    });

    launchWrapper.appendChild(launchButton);
    launchWrapper.appendChild(dropdown);
    actionsContainer.appendChild(launchWrapper);

    // Row click - enter theatre mode without launching a terminal
    row.addEventListener('click', async () => {
      await enterTheatreMode(project.path, project);
    });
  } else {
    // Fallback to View in Finder button
    const openButton = document.createElement('button');
    openButton.className = 'btn btn-primary';
    openButton.textContent = 'View in Finder';
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
