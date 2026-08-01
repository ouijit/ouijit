import { useState, useCallback, useEffect } from 'react';
import type { HookType, ScriptHook } from '../../types';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { HookRowView } from './HookRowView';
import { useProjectStore } from '../../stores/projectStore';

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

  // The hook rows are local state (the store only tracks which types are
  // configured), so a `ouijit hook set` while this panel is open needs its own
  // re-read to avoid showing the old command.
  useEffect(() => {
    return window.api.onCliChange((payload) => {
      if (payload.resource === 'hooks' && payload.project === projectPath) loadHooks();
    });
  }, [loadHooks, projectPath]);

  const handleDialogClose = useCallback(
    (result: { saved: boolean } | null) => {
      setEditingHook(null);
      if (result?.saved) {
        loadHooks();
        // Keep the shared projectStore in sync so terminal headers and kanban
        // column badges see the new hook without a stale window.
        useProjectStore.getState().loadProjectConfig(projectPath);
      }
    },
    [loadHooks, projectPath],
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
          className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06]"
          style={{
            background: 'var(--color-terminal-bg)',
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
