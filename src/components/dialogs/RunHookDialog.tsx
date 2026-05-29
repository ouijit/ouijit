import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScriptHook, HookType } from '../../types';
import { useAutoResize } from '../../hooks/useAutoResize';
import { DialogOverlay } from './DialogOverlay';
import { HookEnvVars } from './HookEnvVars';

const HOOK_TITLES: Record<string, string> = {
  start: 'Start Task',
  continue: 'Continue Task',
  review: 'Review Task',
  done: 'Done',
  run: 'Run',
};

export interface RunHookResult {
  command: string;
  sandboxed: boolean;
  foreground: boolean;
}

interface RunHookDialogProps {
  hookType: HookType;
  hook: ScriptHook;
  projectPath: string;
  /** Name of the task this hook belongs to — shown in the stepper subtitle. */
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
  projectPath,
  taskName,
  queuePosition,
  queueTotal,
  onClose,
  onRunAll,
  onSkipAll,
}: RunHookDialogProps) {
  const [command, setCommand] = useState(hook.command);
  const [sandboxed, setSandboxed] = useState(false);
  const [limaAvailable, setLimaAvailable] = useState(false);
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
    window.api.lima
      .status(projectPath)
      .then((s) => setLimaAvailable(s.available))
      .catch(() => {});
  }, [projectPath]);

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

      <div className="flex gap-2 justify-between mt-4 items-center">
        {limaAvailable ? (
          <div className="flex items-center gap-2" onClick={() => setSandboxed((s) => !s)}>
            <div
              className={`relative w-[34px] h-5 rounded-[10px] shrink-0 transition-[background] duration-200 ease-out ${sandboxed ? 'bg-accent' : 'bg-white/15'}`}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-out ${sandboxed ? 'translate-x-3.5' : ''}`}
              />
            </div>
            <span className="text-xs text-white/40">Sandbox</span>
          </div>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <button data-testid="dialog-cancel" className="btn-secondary" onClick={() => dismiss(null)}>
            {queued ? 'Skip' : 'Cancel'}
          </button>
          <button
            data-testid="dialog-run-open"
            className="btn-primary whitespace-nowrap"
            onClick={() => dismiss({ command: command.trim(), sandboxed, foreground: true })}
            disabled={!command.trim()}
          >
            Run & Open
          </button>
          <button
            data-testid="dialog-run"
            className="btn-primary"
            onClick={() => dismiss({ command: command.trim(), sandboxed, foreground: false })}
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
            onClick={() => dismissRunAll({ command: command.trim(), sandboxed, foreground: false })}
            disabled={!command.trim()}
          >
            Run all
          </button>
        </div>
      )}
    </DialogOverlay>
  );
}
