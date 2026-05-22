import { useState, useRef, useCallback } from 'react';

interface KanbanAddInputProps {
  onAdd: (name: string, description?: string) => void;
}

export function KanbanAddInput({ onAdd }: KanbanAddInputProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setName('');
    setDescription('');
    setActive(false);
  }, []);

  const canSubmit = name.trim().length > 0;

  const submit = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDescription = description.trim();
    onAdd(trimmedName, trimmedDescription || undefined);
    reset();
  }, [name, description, onAdd, reset]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        reset();
        inputRef.current?.blur();
      }
      // Tab falls through to native focus handling, moving into the description field.
    },
    [submit, reset],
  );

  const handleDescriptionKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter inserts a newline so multi-line prompts can be typed; the
      // Create button (or Cmd/Ctrl+Enter) submits.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        reset();
      }
    },
    [submit, reset],
  );

  // Collapse only when focus leaves the whole form and nothing was entered.
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const nextFocus = e.relatedTarget as Node | null;
      if (nextFocus && e.currentTarget.contains(nextFocus)) return;
      if (!name.trim() && !description.trim()) setActive(false);
    },
    [name, description],
  );

  return (
    <div className="kanban-add-form" onBlur={handleBlur}>
      <input
        ref={inputRef}
        type="text"
        className="kanban-add-input w-full font-mono text-sm font-medium text-text-primary bg-transparent px-3 py-3.5 outline-none transition-all duration-150 ease-out border-none focus:bg-white/[0.04]"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
        placeholder="New task..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleNameKeyDown}
        onFocus={() => setActive(true)}
      />
      {active && (
        <>
          <textarea
            className="kanban-add-description w-full font-mono text-xs text-text-secondary bg-transparent px-3 py-2.5 outline-none transition-all duration-150 ease-out border-none resize-none focus:bg-white/[0.04]"
            placeholder="Description (optional)"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleDescriptionKeyDown}
          />
          <div
            className="flex items-center justify-end gap-2 px-3 py-2"
            style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
          >
            <button
              type="button"
              onClick={reset}
              className="px-3 py-1 text-xs text-text-secondary rounded-full hover:bg-white/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              title="Create task (⌘↵)"
              className="px-3 py-1 text-xs font-medium text-white bg-accent rounded-full hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Focus the kanban add input programmatically */
export function focusKanbanAddInput(): void {
  const input = document.querySelector('.kanban-add-input') as HTMLInputElement;
  input?.focus();
}
