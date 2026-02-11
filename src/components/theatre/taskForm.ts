/**
 * Shared task creation form — reused by the dialog (worktreeDropdown)
 * and the empty state (terminalCards).
 */

export interface TaskFormValues {
  name: string | null;
  prompt: string | null;
  branchName: string | null;
  sandboxed: boolean | undefined;
}

export interface TaskFormHandle {
  /** The name input element, for external focus management */
  nameInput: HTMLInputElement;
  /** Read current form values */
  getValues(): TaskFormValues;
  /** False if the branch field has a validation error */
  isValid(): boolean;
  /** Clear debounce timers */
  cleanup(): void;
  /** Disable all inputs and the submit button */
  disable(): void;
  /** Re-enable all inputs and the submit button */
  enable(): void;
  /** Focus the name input */
  focus(): void;
}

/**
 * Build the inner HTML for the task creation form.
 * The caller wraps this in their own composer container.
 */
export function buildTaskFormHtml(limaAvailable: boolean): string {
  return `
    <div class="task-form-scroll">
      <input
        type="text"
        class="task-form-name"
        placeholder="Task name"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="task-form-branch-row">
        <i data-lucide="git-branch" class="task-form-branch-icon"></i>
        <input
          type="text"
          class="task-form-branch"
          placeholder="branch-name"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div class="task-form-branch-error"></div>
      <textarea
        class="task-form-prompt"
        placeholder="Describe what needs to be done..."
        spellcheck="false"
        rows="2"
      ></textarea>
    </div>
    ${limaAvailable ? `
    <div class="task-form-footer">
      <div class="task-form-sandbox-toggle">
        <div class="sandbox-toggle">
          <div class="sandbox-toggle-knob"></div>
        </div>
        <span class="task-form-sandbox-label">Sandbox</span>
      </div>
    </div>
    ` : ''}
    <button type="submit" class="task-form-submit" aria-label="Create task">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  `;
}

/**
 * Wire up shared form behavior on an already-rendered form.
 * `root` is the container element (dialog or empty state) that holds the form.
 */
export function setupTaskForm(
  root: HTMLElement,
  currentProjectPath: string | null,
  limaAvailable: boolean,
): TaskFormHandle {
  const nameInput = root.querySelector('.task-form-name') as HTMLInputElement;
  const branchInput = root.querySelector('.task-form-branch') as HTMLInputElement;
  const branchError = root.querySelector('.task-form-branch-error') as HTMLElement;
  const promptInput = root.querySelector('.task-form-prompt') as HTMLTextAreaElement;
  const submitBtn = root.querySelector('.task-form-submit') as HTMLButtonElement;

  // Render lucide icons scoped to root
  import('lucide').then(({ createIcons, icons }) => {
    createIcons({ icons, nameAttr: 'data-lucide', attrs: {}, nodes: [root] });
  });

  let sandboxState = false;
  let branchDetached = false;
  let branchGenerateTimer: ReturnType<typeof setTimeout> | null = null;
  let branchValidateTimer: ReturnType<typeof setTimeout> | null = null;

  // Auto-generate branch name preview from task name
  const updateBranchPreview = () => {
    if (branchDetached) return;
    const name = nameInput.value.trim();
    if (!name || !currentProjectPath) {
      branchInput.value = '';
      branchInput.classList.remove('task-form-branch--invalid');
      branchError.textContent = '';
      return;
    }
    if (branchGenerateTimer) clearTimeout(branchGenerateTimer);
    branchGenerateTimer = setTimeout(async () => {
      if (branchDetached) return;
      const generated = await window.api.worktree.generateBranchName(currentProjectPath!, name);
      if (!branchDetached) {
        branchInput.value = generated;
        branchInput.classList.remove('task-form-branch--invalid');
        branchError.textContent = '';
      }
    }, 150);
  };

  // Validate branch name
  const validateBranch = () => {
    if (branchValidateTimer) clearTimeout(branchValidateTimer);
    const value = branchInput.value.trim();
    if (!value) {
      branchInput.classList.remove('task-form-branch--invalid');
      branchError.textContent = '';
      return;
    }
    branchValidateTimer = setTimeout(async () => {
      if (!currentProjectPath) return;
      const result = await window.api.worktree.validateBranchName(currentProjectPath, value);
      if (branchInput.value.trim() !== value) return;
      if (!result.valid) {
        branchInput.classList.add('task-form-branch--invalid');
        branchError.textContent = result.error || 'Invalid branch name';
      } else {
        branchInput.classList.remove('task-form-branch--invalid');
        branchError.textContent = '';
      }
    }, 300);
  };

  // Textarea auto-resize
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = promptInput.scrollHeight + 'px';
  });

  // Name input drives branch preview
  nameInput.addEventListener('input', updateBranchPreview);

  // Branch input: detect manual edit (detach) or clearing (re-attach)
  branchInput.addEventListener('input', () => {
    if (branchInput.value === '') {
      branchDetached = false;
      branchInput.classList.remove('task-form-branch--invalid');
      branchError.textContent = '';
      updateBranchPreview();
    } else {
      branchDetached = true;
      validateBranch();
    }
  });

  branchInput.addEventListener('blur', validateBranch);

  // Wire up sandbox toggle if present
  const sandboxToggleRow = root.querySelector('.task-form-sandbox-toggle');
  if (sandboxToggleRow) {
    sandboxToggleRow.addEventListener('click', () => {
      sandboxState = !sandboxState;
      const toggle = sandboxToggleRow.querySelector('.sandbox-toggle');
      if (toggle) {
        toggle.classList.toggle('sandbox-toggle--active', sandboxState);
      }
    });
  }

  // Keyboard navigation
  const form = root.querySelector('form');

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      branchInput.focus();
    }
  });

  branchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      promptInput.focus();
    }
  });

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });

  return {
    nameInput,
    getValues(): TaskFormValues {
      return {
        name: nameInput.value.trim() || null,
        prompt: promptInput.value.trim() || null,
        branchName: branchInput.value.trim() || null,
        sandboxed: limaAvailable ? sandboxState : undefined,
      };
    },
    isValid(): boolean {
      return !branchInput.classList.contains('task-form-branch--invalid');
    },
    cleanup(): void {
      if (branchGenerateTimer) clearTimeout(branchGenerateTimer);
      if (branchValidateTimer) clearTimeout(branchValidateTimer);
    },
    disable(): void {
      nameInput.disabled = true;
      branchInput.disabled = true;
      promptInput.disabled = true;
      submitBtn.disabled = true;
    },
    enable(): void {
      nameInput.disabled = false;
      branchInput.disabled = false;
      promptInput.disabled = false;
      submitBtn.disabled = false;
    },
    focus(): void {
      nameInput.focus();
    },
  };
}
