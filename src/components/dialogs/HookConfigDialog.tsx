import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScriptHook, HookType } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useAutoResize } from '../../hooks/useAutoResize';
import { DialogOverlay } from './DialogOverlay';
import { HookCliHint } from './HookCliHint';
import { HookEnvVars } from './HookEnvVars';

const HOOK_LABELS: Record<HookType, { title: string; description: string; placeholder: string; envVars?: boolean }> = {
  start: {
    title: 'Start Hook',
    description: 'Runs when a task moves from To Do to In Progress',
    placeholder: 'claude "complete the current task and move it into in review"',
    envVars: true,
  },
  continue: {
    title: 'Continue Hook',
    description: 'Runs when reopening a task that is already In Progress',
    placeholder: 'claude -c',
    envVars: true,
  },
  run: {
    title: 'Run',
    description: "Runs from a terminal's + menu",
    placeholder: 'npm run dev',
    envVars: true,
  },
  review: {
    title: 'Review Hook',
    description: 'Runs when a task moves to In Review',
    placeholder: 'claude "open a pull request for the current task"',
    envVars: true,
  },
  done: {
    title: 'Done Hook',
    description: 'Runs when a task moves to Done',
    placeholder: 'git push origin HEAD',
    envVars: true,
  },
  editor: {
    title: 'Editor',
    description: 'Opens the task worktree in your preferred code editor',
    placeholder: 'code',
  },
};

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

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)}>
      <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">{labels.title}</h2>
      <p className="text-sm text-text-secondary leading-snug -mt-2 mb-4">{labels.description}</p>

      <div className="mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="hook-command">
            Command
          </label>
          <textarea
            ref={textareaRef}
            id="hook-command"
            className="w-full px-3 py-2 font-mono text-sm leading-snug text-text-primary bg-background border border-border rounded-md outline-none resize-none overflow-hidden focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary"
            style={{ transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out' }}
            placeholder={labels.placeholder}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              autoResize(e);
            }}
            rows={1}
          />
        </div>

        {isRunHook && (
          <div className="flex flex-col gap-1 mt-3">
            <label className="flex items-center gap-2 cursor-default">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent !cursor-default"
                checked={killExisting}
                onChange={(e) => setKillExisting(e.target.checked)}
              />
              <span className="text-sm text-text-secondary">Kill existing instances before running</span>
            </label>
          </div>
        )}

        {labels.envVars && <HookEnvVars />}
      </div>

      <div className="flex gap-2 justify-between mt-4 items-center">
        {labels.envVars ? <HookCliHint /> : <div />}
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
