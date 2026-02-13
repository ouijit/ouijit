import type { CreateProjectOptions, CreateProjectResult } from '../types';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../utils/hotkeys';

export interface NewProjectDialogResult {
  created: boolean;
  projectName?: string;
  projectPath?: string;
}

/**
 * Validates a project name.
 * Allows alphanumeric characters, spaces, dashes, and underscores.
 */
function isValidProjectName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(name);
}

/**
 * Shows a modal dialog to create a new project
 */
export function showNewProjectDialog(): Promise<NewProjectDialogResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';

    dialog.innerHTML = `
      <h2 class="import-dialog-title">New Project</h2>

      <div class="new-project-form">
        <div class="form-group">
          <label class="form-label" for="project-name">Project Name</label>
          <input
            type="text"
            id="project-name"
            class="form-input"
            placeholder="My Project"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>

      <div class="import-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="create" disabled>Create</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const nameInput = dialog.querySelector('#project-name') as HTMLInputElement;
    const createBtn = dialog.querySelector('[data-action="create"]') as HTMLButtonElement;

    // Validate input on change
    nameInput.addEventListener('input', () => {
      const name = nameInput.value.trim();
      const isValid = name.length > 0 && isValidProjectName(name);
      createBtn.disabled = !isValid;
    });

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('import-dialog--visible');
      nameInput.focus();
    });

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      unregisterHotkey('enter', Scopes.MODAL);
      popScope();
      overlay.classList.remove('modal-overlay--visible');
      dialog.classList.remove('import-dialog--visible');
      setTimeout(() => overlay.remove(), 200);
    };

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    dialog.querySelector('[data-action="create"]')?.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!isValidProjectName(name)) {
        return;
      }

      // Disable button to prevent double-clicks
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      const options: CreateProjectOptions = { name };
      const result: CreateProjectResult = await window.api.createProject(options);

      cleanup();

      if (result.success) {
        resolve({
          created: true,
          projectName: name,
          projectPath: result.projectPath,
        });
      } else {
        resolve({ created: false });
      }
    });

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    // Set up hotkey scope for modal
    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, () => {
      cleanup();
      resolve(null);
    });
    registerHotkey('enter', Scopes.MODAL, () => {
      if (!createBtn.disabled) createBtn.click();
    });
  });
}
