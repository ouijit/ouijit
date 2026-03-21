import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScriptHook } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useAutoResize } from '../../hooks/useAutoResize';
import { DialogOverlay } from './DialogOverlay';

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
  const autoResize = useAutoResize();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (startRef.current) {
      startRef.current.focus();
      startRef.current.style.height = 'auto';
      startRef.current.style.height = `${startRef.current.scrollHeight}px`;
    }
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

  const copyVar = useCallback((varName: string) => {
    navigator.clipboard.writeText(varName);
    setCopiedVar(varName);
    setTimeout(() => setCopiedVar(null), 1500);
  }, []);

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)}>
      <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">Start & Continue Hooks</h2>

      <div className="mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="hook-start-command">
            Start
          </label>
          <p className="text-sm text-text-secondary leading-snug -mt-2 mb-4">
            Runs when a task moves from To Do to In Progress
          </p>
          <textarea
            ref={startRef}
            id="hook-start-command"
            className="w-full px-3 py-2 font-mono text-sm leading-snug text-text-primary bg-background border border-border rounded-md outline-none resize-none overflow-hidden focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary"
            style={{ transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out' }}
            placeholder='npm install && claude "$OUIJIT_TASK_PROMPT"'
            value={startCommand}
            onChange={(e) => {
              setStartCommand(e.target.value);
              autoResize(e);
            }}
            rows={1}
          />
        </div>

        <div className="flex flex-col gap-1 mt-4">
          <label className="text-sm font-medium text-text-secondary" htmlFor="hook-continue-command">
            Continue
          </label>
          <p className="text-sm text-text-secondary leading-snug -mt-2 mb-4">
            Runs when reopening a task that is already In Progress
          </p>
          <textarea
            id="hook-continue-command"
            className="w-full px-3 py-2 font-mono text-sm leading-snug text-text-primary bg-background border border-border rounded-md outline-none resize-none overflow-hidden focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary"
            style={{ transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out' }}
            placeholder="claude -c"
            value={continueCommand}
            onChange={(e) => {
              setContinueCommand(e.target.value);
              autoResize(e);
            }}
            rows={1}
          />
        </div>

        <details className="mt-3 text-xs text-text-secondary [&>summary]:cursor-default [&>summary]:select-none [&_ul]:mt-2 [&_ul]:mb-0 [&_ul]:pl-5 [&_li]:my-1">
          <summary>Environment variables</summary>
          <ul>
            {ENV_VARS.map((v) => (
              <li key={v}>
                <code
                  className={`font-mono text-[13px] px-1.5 py-0.5 rounded inline-block bg-background-secondary hover:text-text-primary hover:bg-border-hover ${copiedVar === v ? 'text-accent !bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]' : ''}`}
                  style={{ transition: 'background 100ms ease, color 100ms ease' }}
                  onClick={() => copyVar(v)}
                >
                  {copiedVar === v ? 'Copied!' : v}
                </code>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="flex gap-2 justify-end mt-4 items-center">
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-accent bg-accent-light hover:bg-[rgba(0,122,255,0.15)]"
          onClick={() => dismiss(null)}
        >
          Cancel
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98]"
          onClick={handleSave}
        >
          Save
        </button>
      </div>
    </DialogOverlay>
  );
}
