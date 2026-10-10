import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScriptHook, HookType, SandboxProviderId } from '../../types';
import { SANDBOXABLE_HOOK_TYPES } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useAutoResize } from '../../hooks/useAutoResize';
import { useHookCommandDefault } from '../../utils/hookDefaults';
import { DialogOverlay } from './DialogOverlay';
import { HookCliHint } from './HookCliHint';
import { HookEnvVars } from './HookEnvVars';
import { Checkbox } from '../ui/Checkbox';
import { SandboxPicker } from '../ui/SandboxPicker';

const HOOK_LABELS: Record<HookType, { title: string; description: string; envVars?: boolean }> = {
  start: {
    title: 'Start Hook',
    description: 'Runs when a task moves from To Do to In Progress',
    envVars: true,
  },
  continue: {
    title: 'Continue Hook',
    description: 'Runs when reopening a task that is already In Progress',
    envVars: true,
  },
  run: {
    title: 'Run',
    description: "Runs from a terminal's + menu",
    envVars: true,
  },
  review: {
    title: 'Review Hook',
    description: 'Runs when a task moves to In Review',
    envVars: true,
  },
  done: {
    title: 'Done Hook',
    description: 'Runs when a task moves to Done',
    envVars: true,
  },
  editor: {
    title: 'Editor',
    description: 'Opens the task worktree in your preferred code editor',
  },
};

interface HookConfigDialogProps {
  projectPath: string;
  hookType: HookType;
  existingHook?: ScriptHook;
  onClose: (result: { saved: boolean; hook?: ScriptHook } | null) => void;
}

export function HookConfigDialog({ projectPath, hookType, existingHook, onClose }: HookConfigDialogProps) {
  const labels = HOOK_LABELS[hookType];
  const placeholder = useHookCommandDefault(hookType);
  const isRunHook = hookType === 'run';
  const sandboxable = SANDBOXABLE_HOOK_TYPES.includes(hookType);

  const [command, setCommand] = useState(existingHook?.command ?? '');
  const [restartIfRunning, setRestartIfRunning] = useState(existingHook?.restartIfRunning ?? false);
  const [sandbox, setSandbox] = useState<SandboxProviderId>(existingHook?.sandbox ?? 'none');
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
    (result: { saved: boolean; hook?: ScriptHook } | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleSave = useCallback(async () => {
    const trimmed = command.trim();

    if (!trimmed) {
      // Empty command = delete hook
      await useProjectStore.getState().deleteHook(projectPath, hookType);
      dismiss({ saved: true });
      return;
    }

    const hook: ScriptHook = {
      id: existingHook?.id ?? `hook-${Date.now()}`,
      type: hookType,
      name: labels.title,
      command: trimmed,
      ...(isRunHook && { restartIfRunning }),
      ...(sandboxable && { sandbox }),
    };

    await useProjectStore.getState().saveHook(projectPath, hook);

    useProjectStore.getState().addToast(`${labels.title} saved`, 'success');
    dismiss({ saved: true, hook });
  }, [
    command,
    projectPath,
    hookType,
    existingHook,
    labels,
    isRunHook,
    restartIfRunning,
    sandboxable,
    sandbox,
    dismiss,
  ]);

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
            placeholder={placeholder}
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
            <Checkbox
              checked={restartIfRunning}
              onChange={setRestartIfRunning}
              label="Restart if it's already running in the task"
            />
          </div>
        )}

        {sandboxable && (
          <div className="mt-3">
            <SandboxPicker value={sandbox} onChange={setSandbox} />
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
