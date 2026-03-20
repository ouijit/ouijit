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
      className={`fixed inset-0 flex justify-center z-[10001] p-10 overflow-y-auto transition-opacity duration-200 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(null);
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`bg-surface rounded-[32px] shadow-lg max-w-[400px] w-[90%] p-6 border border-border overflow-hidden shrink-0 my-auto ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2.5'}`}
        style={{ transition: 'opacity 200ms ease-out, transform 200ms ease-out' }}
      >
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
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-accent"
                  checked={killExisting}
                  onChange={(e) => setKillExisting(e.target.checked)}
                />
                <span className="text-sm text-text-secondary">Kill existing instances before running</span>
              </label>
            </div>
          )}

          {labels.envVars && (
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
          )}
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
      </div>
    </div>,
    document.body,
  );
}
