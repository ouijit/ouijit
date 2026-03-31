import { useState, useCallback, useEffect } from 'react';
import type { HookType, ScriptHook } from '../../types';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';

export interface HookEntry {
  type: HookType;
  label: string;
  description: string;
}

interface HookListProps {
  projectPath: string;
  hooks: HookEntry[];
  /** Render rows without the card wrapper (for embedding in a shared card) */
  bare?: boolean;
}

export function HookList({ projectPath, hooks: hookEntries, bare }: HookListProps) {
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

  const rows = hookEntries.map(({ type, label, description }) => {
    const hook = hooks[type];
    return (
      <div
        key={type}
        className="group flex items-center gap-3 px-3 py-2 hover:bg-white/[0.04] transition-colors duration-100"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">{label}</span>
            <span className="text-[11px] text-text-tertiary">{description}</span>
          </div>
          {hook && <div className="font-mono text-[11px] text-text-secondary mt-0.5 truncate">{hook.command}</div>}
        </div>
        <button
          className="shrink-0 px-2 py-1 text-[11px] bg-transparent border-none text-text-tertiary hover:text-text-primary transition-colors duration-150"
          onClick={() => setEditingHook({ hookType: type, existing: hook })}
        >
          {hook ? 'Edit' : '+ Configure'}
        </button>
      </div>
    );
  });

  return (
    <>
      {bare ? (
        rows
      ) : (
        <div
          className="border border-white/10 rounded-[14px] overflow-hidden divide-y divide-white/[0.06]"
          style={{
            background: 'var(--color-terminal-bg, #171717)',
            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
          }}
        >
          {rows}
        </div>
      )}
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
