import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScriptHook, HookType, SandboxProviderId } from '../../types';
import { useAutoResize } from '../../hooks/useAutoResize';
import { DialogOverlay } from './DialogOverlay';
import { HookEnvVars } from './HookEnvVars';
import { SandboxPicker } from '../ui/SandboxPicker';

const HOOK_TITLES: Record<string, string> = {
  start: 'Start Task',
  continue: 'Continue Task',
  review: 'Review Task',
  done: 'Done',
  run: 'Run',
};

export interface RunHookResult {
  command: string;
  foreground: boolean;
  sandbox: SandboxProviderId;
}

interface RunHookDialogProps {
  hookType: HookType;
  hook: ScriptHook;
  sandbox: SandboxProviderId;
  taskName?: string;
  /** 1-based position of this prompt in the queue (only set when queued). */
  queuePosition?: number;
  /** Total prompts in the current queue run (only set when more than one). */
  queueTotal?: number;
  onClose: (result: RunHookResult | null) => void;
  /** Run this hook with `result`, then run every remaining queued hook with defaults. */
  onRunAll?: (result: RunHookResult) => void;
  /** Skip this hook and every remaining queued hook. */
  onSkipAll?: () => void;
}

export function RunHookDialog({
  hookType,
  hook,
  sandbox: initialSandbox,
  taskName,
  queuePosition,
  queueTotal,
  onClose,
  onRunAll,
  onSkipAll,
}: RunHookDialogProps) {
  const [command, setCommand] = useState(hook.command);
  const [sandbox, setSandbox] = useState(initialSandbox);
  const [visible, setVisible] = useState(false);
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

  const dismissRunAll = useCallback(
    (result: RunHookResult) => {
      setVisible(false);
      setTimeout(() => onRunAll?.(result), 200);
    },
    [onRunAll],
  );

  const dismissSkipAll = useCallback(() => {
    setVisible(false);
    setTimeout(() => onSkipAll?.(), 200);
  }, [onSkipAll]);

  const title = HOOK_TITLES[hookType] || hookType;
  const queued = queueTotal != null && queueTotal > 1;

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)} maxWidth={420}>
      <h2
        data-testid="dialog-title"
        className={`dialog-title text-lg font-semibold text-text-primary text-center ${queued ? 'mb-1' : 'mb-4'}`}
      >
        {title}
      </h2>

      {queued && (
        <div data-testid="hook-queue-stepper" className="text-xs text-text-secondary text-center mb-4">
          Hook {queuePosition} of {queueTotal}
          {taskName ? (
            <span className="text-text-tertiary">
              {' '}
              {'·'} {taskName}
            </span>
          ) : null}
        </div>
      )}

      <textarea
        ref={textareaRef}
        data-testid="hook-command-textarea"
        className="start-command-textarea w-full px-3 py-2 mb-2 font-mono text-sm leading-snug text-text-primary bg-background border border-border rounded-md outline-none resize-none overflow-hidden transition-all duration-150 ease-out focus:border-accent focus:ring-3 focus:ring-accent-light"
        value={command}
        onChange={(e) => {
          setCommand(e.target.value);
          autoResize(e);
        }}
        rows={1}
      />

      <HookEnvVars />

      <div className="mt-3">
        <SandboxPicker value={sandbox} onChange={setSandbox} />
      </div>

      <div className="flex gap-2 justify-end mt-4 items-center">
        <div className="flex gap-2">
          <button data-testid="dialog-cancel" className="btn-secondary" onClick={() => dismiss(null)}>
            {queued ? 'Skip' : 'Cancel'}
          </button>
          <button
            data-testid="dialog-run-open"
            className="btn-primary whitespace-nowrap"
            onClick={() => dismiss({ command: command.trim(), foreground: true, sandbox })}
            disabled={!command.trim()}
          >
            Run & Open
          </button>
          <button
            data-testid="dialog-run"
            className="btn-primary"
            onClick={() => dismiss({ command: command.trim(), foreground: false, sandbox })}
            disabled={!command.trim()}
          >
            Run
          </button>
        </div>
      </div>

      {queued && (
        <div className="flex justify-end items-center gap-4 mt-3 pt-3 border-t border-border text-xs">
          <span className="text-text-tertiary mr-auto">{queueTotal} hooks queued</span>
          <button
            data-testid="dialog-skip-all"
            className="text-text-secondary hover:text-text-primary outline-none [-webkit-app-region:no-drag] transition-colors duration-100"
            onClick={dismissSkipAll}
          >
            Skip all
          </button>
          <button
            data-testid="dialog-run-all"
            className="text-accent hover:text-accent-hover outline-none [-webkit-app-region:no-drag] transition-colors duration-100 disabled:opacity-40"
            onClick={() => dismissRunAll({ command: command.trim(), foreground: false, sandbox })}
            disabled={!command.trim()}
          >
            Run all
          </button>
        </div>
      )}
    </DialogOverlay>
  );
}
