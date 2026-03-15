import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ScriptHook, HookType } from '../../types';
import { useAutoResize } from '../../hooks/useAutoResize';

const HOOK_TITLES: Record<string, string> = {
  start: 'Start Task',
  continue: 'Continue Task',
  review: 'Review Task',
  cleanup: 'Done \u2014 Cleanup',
  run: 'Run',
};

const ENV_VARS = [
  '$OUIJIT_PROJECT_PATH',
  '$OUIJIT_WORKTREE_PATH',
  '$OUIJIT_TASK_BRANCH',
  '$OUIJIT_TASK_NAME',
  '$OUIJIT_TASK_PROMPT',
];

export interface RunHookResult {
  command: string;
  sandboxed: boolean;
  foreground: boolean;
}

interface RunHookDialogProps {
  hookType: HookType;
  hook: ScriptHook;
  taskName: string;
  onClose: (result: RunHookResult | null) => void;
}

export function RunHookDialog({ hookType, hook, taskName, onClose }: RunHookDialogProps) {
  const [command, setCommand] = useState(hook.command);
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
    (result: RunHookResult | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

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

  const title = HOOK_TITLES[hookType] || hookType;

  return createPortal(
    <div
      className={`modal-overlay${visible ? ' modal-overlay--visible' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(null);
      }}
      onKeyDown={handleKeyDown}
    >
      <div className={`dialog${visible ? ' dialog--visible' : ''}`}>
        <h2 className="dialog-title">{title}</h2>
        <p className="hook-description">{taskName}</p>

        <div className="new-project-form">
          <div className="form-group">
            <textarea
              ref={textareaRef}
              className="form-input form-textarea start-command-textarea"
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                autoResize(e);
              }}
              rows={1}
              style={{ overflow: 'hidden', resize: 'none' }}
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
          <button
            className="btn btn-secondary"
            onClick={() => dismiss({ command: command.trim(), sandboxed: false, foreground: false })}
            disabled={!command.trim()}
          >
            Run
          </button>
          <button
            className="btn btn-primary"
            onClick={() => dismiss({ command: command.trim(), sandboxed: false, foreground: true })}
            disabled={!command.trim()}
          >
            Run & Open
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
