import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ScriptHook, HookType } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useAutoResize } from '../../hooks/useAutoResize';

const HOOK_LABELS: Record<HookType, { title: string; description: string; placeholder: string; envVars?: boolean }> = {
  start: {
    title: 'Start Hook',
    description: 'Runs when a task moves from To Do to In Progress',
    placeholder: 'npm install && claude "$OUIJIT_TASK_PROMPT"',
    envVars: true,
  },
  continue: {
    title: 'Continue Hook',
    description: 'Runs when reopening a task that is already In Progress',
    placeholder: 'claude -c',
    envVars: true,
  },
  run: {
    title: 'Run Hook',
    description: 'Runs when you click Run',
    placeholder: 'npm run dev',
    envVars: true,
  },
  review: {
    title: 'Review Hook',
    description: 'Runs when a task moves to In Review',
    placeholder: 'gh pr create --fill',
    envVars: true,
  },
  cleanup: {
    title: 'Cleanup Hook',
    description: 'Runs when a task moves to Done',
    placeholder: 'git push origin HEAD',
    envVars: true,
  },
  'sandbox-setup': {
    title: 'Sandbox Setup',
    description: 'Runs inside the VM before each terminal command',
    placeholder: 'which claude || npm i -g @anthropic-ai/claude-code',
  },
  editor: {
    title: 'Editor',
    description: 'Opens the task worktree in your preferred code editor',
    placeholder: 'code',
  },
};

const ENV_VARS = [
  '$OUIJIT_PROJECT_PATH',
  '$OUIJIT_WORKTREE_PATH',
  '$OUIJIT_TASK_BRANCH',
  '$OUIJIT_TASK_NAME',
  '$OUIJIT_TASK_PROMPT',
];

interface HookConfigDialogProps {
  projectPath: string;
  hookType: HookType;
  existingHook?: ScriptHook;
  killExistingOnRun?: boolean;
  onClose: (result: { saved: boolean; hook?: ScriptHook; killExistingOnRun?: boolean } | null) => void;
}

export function HookConfigDialog({
  projectPath,
  hookType,
  existingHook,
  killExistingOnRun,
  onClose,
}: HookConfigDialogProps) {
  const labels = HOOK_LABELS[hookType];
  const isRunHook = hookType === 'run';

  const [command, setCommand] = useState(existingHook?.command ?? '');
  const [killExisting, setKillExisting] = useState(killExistingOnRun !== false);
  const [visible, setVisible] = useState(false);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useAutoResize();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, []);

  const dismiss = useCallback(
    (result: { saved: boolean; hook?: ScriptHook; killExistingOnRun?: boolean } | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleSave = useCallback(async () => {
    const trimmed = command.trim();

    if (!trimmed) {
      // Empty command = delete hook
      await window.api.hooks.delete(projectPath, hookType);
      dismiss({ saved: true });
      return;
    }

    const hook: ScriptHook = {
      id: existingHook?.id ?? `hook-${Date.now()}`,
      type: hookType,
      name: labels.title,
      command: trimmed,
    };

    await window.api.hooks.save(projectPath, hook);

    if (isRunHook) {
      await window.api.setKillExistingOnRun(projectPath, killExisting);
    }

    useProjectStore.getState().addToast(`${labels.title} saved`, 'success');
    dismiss({ saved: true, hook, killExistingOnRun: killExisting });
  }, [command, projectPath, hookType, existingHook, labels, isRunHook, killExisting, dismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss(null);
      }
    },
    [dismiss],
  );

  const copyVar = useCallback((varName: string) => {
    navigator.clipboard.writeText(varName);
    setCopiedVar(varName);
    setTimeout(() => setCopiedVar(null), 1500);
  }, []);

  return createPortal(
    <div
      className={`modal-overlay${visible ? ' modal-overlay--visible' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(null);
      }}
      onKeyDown={handleKeyDown}
    >
      <div className={`dialog${visible ? ' dialog--visible' : ''}`}>
        <h2 className="dialog-title">{labels.title}</h2>
        <p className="hook-description">{labels.description}</p>

        <div className="new-project-form">
          <div className="form-group">
            <label className="form-label" htmlFor="hook-command">
              Command
            </label>
            <textarea
              ref={textareaRef}
              id="hook-command"
              className="form-input form-textarea"
              placeholder={labels.placeholder}
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                autoResize(e);
              }}
              rows={1}
              style={{ overflow: 'hidden', resize: 'none' }}
            />
          </div>

          {isRunHook && (
            <div className="form-group">
              <label className="custom-checkbox">
                <input type="checkbox" checked={killExisting} onChange={(e) => setKillExisting(e.target.checked)} />
                <span className="custom-checkbox-label">Kill existing instances before running</span>
              </label>
            </div>
          )}

          {labels.envVars && (
            <details className="hook-env-vars">
              <summary>Environment variables</summary>
              <ul>
                {ENV_VARS.map((v) => (
                  <li key={v}>
                    <code
                      className={`hook-env-var${copiedVar === v ? ' hook-env-var--copied' : ''}`}
                      onClick={() => copyVar(v)}
                    >
                      {copiedVar === v ? 'Copied!' : v}
                    </code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={() => dismiss(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
