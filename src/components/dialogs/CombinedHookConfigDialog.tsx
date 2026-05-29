import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScriptHook } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useAutoResize } from '../../hooks/useAutoResize';
import { DialogOverlay } from './DialogOverlay';
import { HookCliHint } from './HookCliHint';
import { HookEnvVars } from './HookEnvVars';

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
            placeholder='claude "complete the current task and move it into in review"'
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

        <HookEnvVars />
      </div>

      <div className="flex gap-2 justify-between mt-4 items-center">
        <HookCliHint />
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => dismiss(null)}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
