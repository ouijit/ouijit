import type { CustomCommand } from '../types';

export interface CustomCommandDialogResult {
  saved: boolean;
  command?: CustomCommand;
  setAsDefault?: boolean;
}

/**
 * Generates a unique ID for a custom command
 */
function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Shows a modal dialog to add or edit a custom command
 */
export function showCustomCommandDialog(
  projectPath: string,
  existingCommand?: CustomCommand,
  options?: { defaultToDefault?: boolean }
): Promise<CustomCommandDialogResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';

    const isEdit = !!existingCommand;
    const title = isEdit ? 'Edit Command' : 'Add Custom Command';

    dialog.innerHTML = `
      <h2 class="import-dialog-title">${title}</h2>

      <div class="new-project-form">
        <div class="form-group">
          <label class="form-label" for="command-name">Name</label>
          <input
            type="text"
            id="command-name"
            class="form-input"
            placeholder="e.g., build:prod"
            autocomplete="off"
            spellcheck="false"
            value="${existingCommand?.name || ''}"
          />
        </div>

        <div class="form-group" style="margin-top: 12px;">
          <label class="form-label" for="command-value">Command</label>
          <input
            type="text"
            id="command-value"
            class="form-input"
            placeholder="e.g., npm run build -- --prod"
            autocomplete="off"
            spellcheck="false"
            value="${existingCommand?.command || ''}"
          />
        </div>

        <div class="form-group" style="margin-top: 12px;">
          <label class="custom-checkbox">
            <input type="checkbox" id="set-as-default" ${options?.defaultToDefault ? 'checked' : ''} />
            <span class="custom-checkbox-label">Set as default</span>
          </label>
        </div>
      </div>

      <div class="import-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" disabled>${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const nameInput = dialog.querySelector('#command-name') as HTMLInputElement;
    const commandInput = dialog.querySelector('#command-value') as HTMLInputElement;
    const defaultCheckbox = dialog.querySelector('#set-as-default') as HTMLInputElement;
    const saveBtn = dialog.querySelector('[data-action="save"]') as HTMLButtonElement;

    // Validate inputs
    const validateInputs = () => {
      const name = nameInput.value.trim();
      const command = commandInput.value.trim();
      saveBtn.disabled = name.length === 0 || command.length === 0;
    };

    nameInput.addEventListener('input', validateInputs);
    commandInput.addEventListener('input', validateInputs);

    // Initial validation
    validateInputs();

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('import-dialog--visible');
      nameInput.focus();
    });

    const cleanup = () => {
      overlay.classList.remove('modal-overlay--visible');
      dialog.classList.remove('import-dialog--visible');
      setTimeout(() => overlay.remove(), 200);
    };

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    dialog.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const command = commandInput.value.trim();

      if (name.length === 0 || command.length === 0) {
        return;
      }

      const customCommand: CustomCommand = {
        id: existingCommand?.id || generateId(),
        name,
        command,
      };

      // Save the command
      const result = await window.api.saveCustomCommand(projectPath, customCommand);

      if (result.success) {
        // Optionally set as default
        if (defaultCheckbox.checked) {
          await window.api.setDefaultCommand(projectPath, customCommand.id);
        }

        cleanup();
        resolve({
          saved: true,
          command: customCommand,
          setAsDefault: defaultCheckbox.checked,
        });
      } else {
        cleanup();
        resolve({ saved: false });
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    // Handle escape key and enter key
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
        document.removeEventListener('keydown', handleKeydown);
      } else if (e.key === 'Enter' && !saveBtn.disabled) {
        saveBtn.click();
      }
    };
    document.addEventListener('keydown', handleKeydown);
  });
}
