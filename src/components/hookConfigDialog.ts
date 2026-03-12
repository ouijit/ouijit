import type { ScriptHook, HookType } from '../types';
import { registerHotkey, unregisterHotkey, pushScope, popScope, Scopes } from '../utils/hotkeys';
import { setupHighlightedTextarea } from '../utils/html';
import { showToast } from './importDialog';
import { generateId } from '../utils/ids';

export interface HookConfigDialogResult {
  saved: boolean;
  hook?: ScriptHook;
  killExistingOnRun?: boolean;
}

export interface HookConfigDialogOptions {
  /** Current value of killExistingOnRun setting (only used for run hook) */
  killExistingOnRun?: boolean;
}

const HOOK_LABELS: Record<HookType, { title: string; description: string; placeholder: string; envVars?: boolean }> = {
  start: {
    title: 'Start Hook',
    description: 'Runs when a task moves from To Do to In Progress (e.g., install dependencies and start Claude)',
    placeholder: 'npm install && claude "$OUIJIT_TASK_PROMPT"',
    envVars: true,
  },
  continue: {
    title: 'Continue Hook',
    description: 'Runs when reopening a task that is already In Progress (e.g., resume Claude session)',
    placeholder: 'claude -c',
    envVars: true,
  },
  run: {
    title: 'Run Hook',
    description: 'Runs when you click Run (e.g., start dev server)',
    placeholder: 'npm run dev',
    envVars: true,
  },
  review: {
    title: 'Review Hook',
    description: 'Runs when a task moves to In Review (e.g., open a PR, run linting)',
    placeholder: 'gh pr create --fill',
    envVars: true,
  },
  cleanup: {
    title: 'Cleanup Hook',
    description: 'Runs when a task moves to Done (e.g., push to remote)',
    placeholder: 'git push origin HEAD',
    envVars: true,
  },
  'sandbox-setup': {
    title: 'Sandbox Setup',
    description: 'Runs inside the VM before each terminal command. Use idempotent commands so repeated runs are fast.',
    placeholder: 'which claude || npm i -g @anthropic-ai/claude-code',
  },
  editor: {
    title: 'Editor',
    description: 'Opens the task worktree in your preferred code editor',
    placeholder: 'code',
  },
};

export interface CombinedHookConfigDialogResult {
  saved: boolean;
  startHook?: ScriptHook;
  continueHook?: ScriptHook;
}

/**
 * Show a combined dialog for configuring both start and continue hooks.
 */
export function showCombinedHookConfigDialog(
  projectPath: string,
  existingStart?: ScriptHook,
  existingContinue?: ScriptHook,
): Promise<CombinedHookConfigDialogResult | null> {
  return new Promise((resolve) => {
    const startLabels = HOOK_LABELS.start;
    const continueLabels = HOOK_LABELS.continue;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';

    const envVarsList = [
      '$OUIJIT_PROJECT_PATH',
      '$OUIJIT_WORKTREE_PATH',
      '$OUIJIT_TASK_BRANCH',
      '$OUIJIT_TASK_NAME',
      '$OUIJIT_TASK_PROMPT',
    ];
    const envVarsHtml = `
      <details class="hook-env-vars" style="-webkit-app-region: no-drag;">
        <summary>Environment variables</summary>
        <ul>${envVarsList.map((v) => `<li><code class="hook-env-var" data-var="${v}">${v}</code></li>`).join('')}</ul>
      </details>
    `;

    dialog.innerHTML = `
      <h2 class="dialog-title">Start & Continue Hooks</h2>

      <div class="new-project-form">
        <div class="form-group">
          <label class="form-label" for="hook-start-command">Start</label>
          <p class="hook-description">${startLabels.description}</p>
          <textarea
            id="hook-start-command"
            class="form-input form-textarea"
            placeholder="${startLabels.placeholder}"
            autocomplete="off"
            spellcheck="false"
            rows="1"
          >${existingStart?.command || ''}</textarea>
        </div>

        <div class="form-group" style="margin-top: 16px;">
          <label class="form-label" for="hook-continue-command">Continue</label>
          <p class="hook-description">${continueLabels.description}</p>
          <textarea
            id="hook-continue-command"
            class="form-input form-textarea"
            placeholder="${continueLabels.placeholder}"
            autocomplete="off"
            spellcheck="false"
            rows="1"
          >${existingContinue?.command || ''}</textarea>
        </div>

        ${envVarsHtml}
      </div>

      <div class="dialog-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save">Save</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Wire up click-to-copy on env var codes
    dialog.querySelectorAll('.hook-env-var').forEach((code) => {
      code.addEventListener('click', () => {
        const varName = (code as HTMLElement).dataset.var!;
        navigator.clipboard.writeText(varName);
        code.classList.add('hook-env-var--copied');
        const original = code.textContent;
        code.textContent = 'Copied!';
        setTimeout(() => {
          code.textContent = original;
          code.classList.remove('hook-env-var--copied');
        }, 800);
      });
    });

    const startInput = dialog.querySelector('#hook-start-command') as HTMLTextAreaElement;
    const continueInput = dialog.querySelector('#hook-continue-command') as HTMLTextAreaElement;
    setupHighlightedTextarea(startInput);
    setupHighlightedTextarea(continueInput);

    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('dialog--visible');
      startInput.focus();
    });

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      overlay.classList.remove('modal-overlay--visible');
      dialog.classList.remove('dialog--visible');
      setTimeout(() => overlay.remove(), 200);
    };

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    dialog.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
      const startCmd = startInput.value.trim();
      const continueCmd = continueInput.value.trim();

      let startHook: ScriptHook | undefined;
      let continueHook: ScriptHook | undefined;

      // Save or delete start hook
      if (startCmd.length === 0) {
        await window.api.hooks.delete(projectPath, 'start');
      } else {
        startHook = {
          id: existingStart?.id || generateId('hook'),
          type: 'start',
          name: startLabels.title,
          command: startCmd,
        };
        await window.api.hooks.save(projectPath, startHook);
      }

      // Save or delete continue hook
      if (continueCmd.length === 0) {
        await window.api.hooks.delete(projectPath, 'continue');
      } else {
        continueHook = {
          id: existingContinue?.id || generateId('hook'),
          type: 'continue',
          name: continueLabels.title,
          command: continueCmd,
        };
        await window.api.hooks.save(projectPath, continueHook);
      }

      cleanup();
      resolve({ saved: true, startHook, continueHook });
    });

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, () => {
      cleanup();
      resolve(null);
    });
  });
}

export function showHookConfigDialog(
  projectPath: string,
  hookType: HookType,
  existingHook?: ScriptHook,
  options?: HookConfigDialogOptions,
): Promise<HookConfigDialogResult | null> {
  return new Promise((resolve) => {
    const labels = HOOK_LABELS[hookType];
    const isRunHook = hookType === 'run';
    const killExistingChecked = options?.killExistingOnRun !== false;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';

    const envVarsList = [
      '$OUIJIT_PROJECT_PATH',
      '$OUIJIT_WORKTREE_PATH',
      '$OUIJIT_TASK_BRANCH',
      '$OUIJIT_TASK_NAME',
      '$OUIJIT_TASK_PROMPT',
    ];
    const envVarsHtml = labels.envVars
      ? `
      <details class="hook-env-vars" style="-webkit-app-region: no-drag;">
        <summary>Environment variables</summary>
        <ul>${envVarsList.map((v) => `<li><code class="hook-env-var" data-var="${v}">${v}</code></li>`).join('')}</ul>
      </details>
    `
      : '';

    dialog.innerHTML = `
      <h2 class="dialog-title">${labels.title}</h2>
      <p class="hook-description">${labels.description}</p>

      <div class="new-project-form">
        <div class="form-group">
          <label class="form-label" for="hook-command">Command</label>
          <textarea
            id="hook-command"
            class="form-input form-textarea"
            placeholder="${labels.placeholder}"
            autocomplete="off"
            spellcheck="false"
            rows="1"
          >${existingHook?.command || ''}</textarea>
        </div>

        ${
          isRunHook
            ? `
        <div class="form-group" style="margin-top: 12px;">
          <label class="custom-checkbox">
            <input type="checkbox" id="kill-existing" ${killExistingChecked ? 'checked' : ''} />
            <span class="custom-checkbox-label">Stop existing processes before starting</span>
          </label>
        </div>
        `
            : ''
        }

        ${envVarsHtml}
      </div>

      <div class="dialog-actions">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save">Save</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Wire up click-to-copy on env var codes
    dialog.querySelectorAll('.hook-env-var').forEach((code) => {
      code.addEventListener('click', () => {
        const varName = (code as HTMLElement).dataset.var!;
        navigator.clipboard.writeText(varName);
        code.classList.add('hook-env-var--copied');
        const original = code.textContent;
        code.textContent = 'Copied!';
        setTimeout(() => {
          code.textContent = original;
          code.classList.remove('hook-env-var--copied');
        }, 800);
      });
    });

    const commandInput = dialog.querySelector('#hook-command') as HTMLTextAreaElement;
    setupHighlightedTextarea(commandInput);

    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay--visible');
      dialog.classList.add('dialog--visible');
      commandInput.focus();
    });

    const cleanup = () => {
      unregisterHotkey('escape', Scopes.MODAL);
      popScope();
      overlay.classList.remove('modal-overlay--visible');
      dialog.classList.remove('dialog--visible');
      setTimeout(() => overlay.remove(), 200);
    };

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    dialog.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
      const command = commandInput.value.trim();

      // Empty command = clear the hook
      if (command.length === 0) {
        await window.api.hooks.delete(projectPath, hookType);
        cleanup();
        resolve({ saved: true, hook: undefined });
        return;
      }

      const hook: ScriptHook = {
        id: existingHook?.id || generateId('hook'),
        type: hookType,
        name: labels.title,
        command,
      };

      const result = await window.api.hooks.save(projectPath, hook);

      // Save kill setting for run hook
      let killExistingValue: boolean | undefined;
      if (isRunHook) {
        const killCheckbox = dialog.querySelector('#kill-existing') as HTMLInputElement;
        killExistingValue = killCheckbox?.checked ?? true;
        await window.api.setKillExistingOnRun(projectPath, killExistingValue);
      }

      if (result.success) {
        cleanup();
        resolve({ saved: true, hook, killExistingOnRun: killExistingValue });
      } else {
        showToast('Failed to save hook', 'error');
        cleanup();
        resolve({ saved: false });
      }
    });

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    pushScope(Scopes.MODAL);
    registerHotkey('escape', Scopes.MODAL, () => {
      cleanup();
      resolve(null);
    });
  });
}
