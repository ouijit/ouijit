import { useState } from 'react';
import type { HookType, ProjectHooks, ScriptHook } from '../../types';
import { SANDBOX_BACKEND_LABELS, isActiveSandbox } from '../../types';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { HookRowView } from './HookRowView';
import { useProjectStore } from '../../stores/projectStore';

const NO_HOOKS: ProjectHooks = {};

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
  const hooks = useProjectStore((s) => (s.configProjectPath === projectPath ? s.hooks : NO_HOOKS));
  const [editingHook, setEditingHook] = useState<{ hookType: HookType; existing?: ScriptHook } | null>(null);

  const rows = hookEntries.map(({ type, label, description }) => {
    const hook = hooks[type];
    return (
      <HookRowView
        key={type}
        label={label}
        description={description}
        command={hook?.command}
        sandboxLabel={isActiveSandbox(hook?.sandbox) ? SANDBOX_BACKEND_LABELS[hook.sandbox] : undefined}
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
          className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-separator"
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
          onClose={() => setEditingHook(null)}
        />
      )}
    </>
  );
}
