import { useState, useCallback, useEffect } from 'react';
import type { HookType, ScriptHook } from '../../types';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { HookRowView } from './HookRowView';

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
      <HookRowView
        key={type}
        label={label}
        description={description}
        command={hook?.command}
        onAction={() => setEditingHook({ hookType: type, existing: hook })}
      />
    );
  });

  return (
    <>
      {bare ? (
        rows
      ) : (
        <div
          className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06]"
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
