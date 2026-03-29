import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { Script } from '../../types';
import { Icon } from '../terminal/Icon';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ScriptListProps {
  projectPath: string;
}

export function ScriptList({ projectPath }: ScriptListProps) {
  const scripts = useProjectStore((s) => s.scripts);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const reload = useCallback(() => {
    useProjectStore.getState().loadScripts(projectPath);
  }, [projectPath]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = scripts.findIndex((s) => s.id === active.id);
      const newIndex = scripts.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(scripts, oldIndex, newIndex);
      // Optimistic update
      useProjectStore.setState({ scripts: reordered });
      await window.api.scripts.reorder(
        projectPath,
        reordered.map((s) => s.id),
      );
      reload();
    },
    [scripts, projectPath, reload],
  );

  const handleSave = useCallback(
    async (script: Script) => {
      await window.api.scripts.save(projectPath, script);
      reload();
      setExpandedId(null);
      setAddingNew(false);
    },
    [projectPath, reload],
  );

  const handleDelete = useCallback(
    async (scriptId: string) => {
      await window.api.scripts.delete(projectPath, scriptId);
      reload();
      setExpandedId(null);
      useProjectStore.getState().addToast('Script deleted', 'success');
    },
    [projectPath, reload],
  );

  const handleAddNew = useCallback(() => {
    setAddingNew(true);
    setExpandedId(null);
  }, []);

  const handleCancelAdd = useCallback(() => {
    setAddingNew(false);
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setAddingNew(false);
  }, []);

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={scripts.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="border border-border rounded-md overflow-hidden divide-y divide-border">
            {scripts.map((script) => (
              <SortableScriptRow
                key={script.id}
                script={script}
                expanded={expandedId === script.id}
                onToggle={() => handleToggleExpand(script.id)}
                onSave={handleSave}
                onDelete={() => handleDelete(script.id)}
              />
            ))}
            {scripts.length === 0 && !addingNew && (
              <div className="px-4 py-6 text-center text-xs text-text-tertiary">No scripts yet. Add one below.</div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {addingNew && (
        <div className="mt-2 border border-border rounded-md overflow-hidden">
          <ScriptForm onSave={handleSave} onCancel={handleCancelAdd} />
        </div>
      )}

      <button
        className="mt-3 flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary bg-transparent border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-colors duration-150"
        onClick={handleAddNew}
      >
        <Icon name="plus" className="w-3.5 h-3.5" />
        Add Script
      </button>
    </div>
  );
}

// ── Sortable row ────────────────────────────────────────────────────

function SortableScriptRow({
  script,
  expanded,
  onToggle,
  onSave,
  onDelete,
}: {
  script: Script;
  expanded: boolean;
  onToggle: () => void;
  onSave: (script: Script) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: script.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="flex items-center gap-2 px-3 py-2 bg-background-secondary hover:bg-background-tertiary transition-colors duration-100"
        onClick={onToggle}
      >
        <button
          className="flex items-center justify-center w-5 h-5 text-text-tertiary hover:text-text-secondary shrink-0 touch-none"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="dots-six-vertical" className="w-4 h-4" />
        </button>
        <span className="text-xs font-medium text-text-primary truncate">{script.name}</span>
        <span className="text-[11px] text-text-tertiary truncate ml-auto font-mono">{script.command}</span>
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="w-3 h-3 text-text-tertiary shrink-0" />
      </div>
      {expanded && <ScriptForm initial={script} onSave={onSave} onCancel={onToggle} onDelete={onDelete} />}
    </div>
  );
}

// ── Inline edit form ────────────────────────────────────────────────

function ScriptForm({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: Script;
  onSave: (script: Script) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initial) {
      nameRef.current?.focus();
    }
  }, [initial]);

  const handleSubmit = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName || !trimmedCommand) return;
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: trimmedName,
      command: trimmedCommand,
      sortOrder: initial?.sortOrder ?? 0,
    });
  }, [name, command, initial, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        handleSubmit();
      }
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [handleSubmit, onCancel],
  );

  const isValid = name.trim() && command.trim();

  return (
    <div className="px-4 py-3 bg-background-primary space-y-3" onClick={(e) => e.stopPropagation()}>
      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Name</label>
        <input
          ref={nameRef}
          className="w-full px-2.5 py-1.5 text-xs text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Lint, Test, Build"
        />
      </div>
      <div>
        <label className="block text-[11px] text-text-tertiary mb-1">Command</label>
        <input
          className="w-full px-2.5 py-1.5 text-xs text-text-primary bg-background-secondary border border-border rounded-md outline-none focus:border-accent transition-colors font-mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. npm run lint"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        {onDelete && (
          <button
            className="px-3 py-1.5 text-xs text-[#ff6b6b] bg-transparent border border-[#ff6b6b]/30 rounded-md hover:bg-[#ff6b6b]/10 transition-colors duration-150"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
        <div className="flex-1" />
        <button
          className="px-3 py-1.5 text-xs text-text-secondary bg-transparent border border-border rounded-md hover:bg-background-tertiary transition-colors duration-150"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 ${
            isValid ? 'text-white bg-accent hover:bg-accent-hover' : 'text-text-tertiary bg-background-tertiary'
          }`}
          disabled={!isValid}
          onClick={handleSubmit}
        >
          Save
        </button>
      </div>
    </div>
  );
}
