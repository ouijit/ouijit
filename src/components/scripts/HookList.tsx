import { useState, useCallback, useEffect } from 'react';
import type { HookType, ScriptHook } from '../../types';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';

const HOOKS: { type: HookType; label: string; description: string }[] = [
  { type: 'run', label: 'Run', description: 'Runs when you click Run' },
  { type: 'start', label: 'Start', description: 'Runs when a task moves to In Progress' },
  { type: 'continue', label: 'Continue', description: 'Runs when reopening an In Progress task' },
  { type: 'review', label: 'Review', description: 'Runs when a task moves to In Review' },
  { type: 'cleanup', label: 'Cleanup', description: 'Runs when a task moves to Done' },
  { type: 'editor', label: 'Editor', description: 'Opens the task worktree in your editor' },
  { type: 'sandbox-setup', label: 'Sandbox Setup', description: 'Runs inside the VM before each command' },
];

interface HookListProps {
  projectPath: string;
}

export function HookList({ projectPath }: HookListProps) {
  const [hooks, setHooks] = useState<Record<string, ScriptHook | undefined>>({});
  const [editingHook, setEditingHook] = useState<{ hookType: HookType; existing?: ScriptHook } | null>(null);

  const loadHooks = useCallback(() => {
    window.api.hooks.get(projectPath).then((h) => {
      setHooks(h as Record<string, ScriptHook | undefined>);
    });
  }, [projectPath]);

  useEffect(() => {
    loadHooks();
  }, [loadHooks]);

  const handleDialogClose = useCallback(
    (result: { saved: boolean } | null) => {
      setEditingHook(null);
      if (result?.saved) loadHooks();
    },
    [loadHooks],
  );

  return (
    <>
      <div className="border border-border rounded-md overflow-hidden divide-y divide-border">
        {HOOKS.map(({ type, label, description }) => {
          const hook = hooks[type];
          return (
            <div
              key={type}
              className="group flex items-center gap-3 px-3 py-2 bg-background-secondary hover:bg-background-tertiary transition-colors duration-100"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">{label}</span>
                  <span className="text-[11px] text-text-tertiary">{description}</span>
                </div>
                {hook && (
                  <div className="font-mono text-[11px] text-text-secondary mt-0.5 truncate">{hook.command}</div>
                )}
              </div>
              <button
                className="shrink-0 px-2 py-1 text-[11px] bg-transparent border-none text-text-tertiary hover:text-text-primary transition-colors duration-150"
                onClick={() => setEditingHook({ hookType: type, existing: hook })}
              >
                {hook ? 'Edit' : '+ Configure'}
              </button>
            </div>
          );
        })}
      </div>
      {editingHook && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType={editingHook.hookType}
          existingHook={editingHook.existing}
          onClose={handleDialogClose}
        />
      )}
    </>
  );
}
