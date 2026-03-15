import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ScriptHook } from '../../types';
import { useProjectStore } from '../../stores/projectStore';

const ENV_VARS = [
  '$OUIJIT_PROJECT_PATH',
  '$OUIJIT_WORKTREE_PATH',
  '$OUIJIT_TASK_BRANCH',
  '$OUIJIT_TASK_NAME',
  '$OUIJIT_TASK_PROMPT',
];

interface CombinedHookConfigDialogProps {
  projectPath: string;
  existingStart?: ScriptHook;
  existingContinue?: ScriptHook;
  onClose: (result: { saved: boolean } | null) => void;
}

export function CombinedHookConfigDialog({
  projectPath,
  existingStart,
  existingContinue,
  onClose,
}: CombinedHookConfigDialogProps) {
  const [startCommand, setStartCommand] = useState(existingStart?.command ?? '');
  const [continueCommand, setContinueCommand] = useState(existingContinue?.command ?? '');
  const [visible, setVisible] = useState(false);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const startRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    startRef.current?.focus();
  }, []);

  const dismiss = useCallback(
    (result: { saved: boolean } | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleSave = useCallback(async () => {
    const startTrimmed = startCommand.trim();
    const continueTrimmed = continueCommand.trim();

    // Save or delete start hook
    if (startTrimmed) {
      await window.api.hooks.save(projectPath, {
        id: existingStart?.id ?? `hook-${Date.now()}`,
        type: 'start',
        name: 'Start Hook',
        command: startTrimmed,
      });
    } else if (existingStart) {
      await window.api.hooks.delete(projectPath, 'start');
    }

    // Save or delete continue hook
    if (continueTrimmed) {
      await window.api.hooks.save(projectPath, {
        id: existingContinue?.id ?? `hook-${Date.now() + 1}`,
        type: 'continue',
        name: 'Continue Hook',
        command: continueTrimmed,
      });
    } else if (existingContinue) {
      await window.api.hooks.delete(projectPath, 'continue');
    }

    useProjectStore.getState().addToast('Hooks saved', 'success');
    dismiss({ saved: true });
  }, [startCommand, continueCommand, projectPath, existingStart, existingContinue, dismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(null);
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
        <h2 className="dialog-title">Start & Continue Hooks</h2>

        <div className="new-project-form">
          <div className="form-group">
            <label className="form-label" htmlFor="hook-start-command">
              Start
            </label>
            <p className="hook-description">Runs when a task moves from To Do to In Progress</p>
            <textarea
              ref={startRef}
              id="hook-start-command"
              className="form-input form-textarea"
              placeholder='npm install && claude "$OUIJIT_TASK_PROMPT"'
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
              rows={1}
            />
          </div>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label" htmlFor="hook-continue-command">
              Continue
            </label>
            <p className="hook-description">Runs when reopening a task that is already In Progress</p>
            <textarea
              id="hook-continue-command"
              className="form-input form-textarea"
              placeholder="claude -c"
              value={continueCommand}
              onChange={(e) => setContinueCommand(e.target.value)}
              rows={1}
            />
          </div>

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
