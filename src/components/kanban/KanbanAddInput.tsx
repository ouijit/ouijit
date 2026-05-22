import { useState, useRef, useCallback } from 'react';

interface KanbanAddInputProps {
  onAdd: (name: string, description?: string) => void;
}

export function KanbanAddInput({ onAdd }: KanbanAddInputProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reset = useCallback(() => {
    setName('');
    setDescription('');
    setActive(false);
  }, []);

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
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        reset();
        textareaRef.current?.blur();
      }
      // A bare Enter inserts a newline so multi-line prompts can be typed.
    },
    [submit, reset],
  );

  const handleBlur = useCallback(() => {
    // Collapse the description field only when nothing has been entered.
    if (!name.trim() && !description.trim()) {
      setActive(false);
    }
  }, [name, description]);

  const showDescription = active || description.length > 0;

  return (
    <div className="kanban-add-form">
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
        onBlur={handleBlur}
      />
      {showDescription && (
        <textarea
          ref={textareaRef}
          className="kanban-add-description w-full font-mono text-xs text-text-secondary bg-transparent px-3 py-2.5 outline-none transition-all duration-150 ease-out border-none resize-none focus:bg-white/[0.04]"
          style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
          placeholder="Description (optional). ⌘↵ to create"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleDescriptionKeyDown}
          onFocus={() => setActive(true)}
          onBlur={handleBlur}
        />
      )}
    </div>
  );
}

/** Focus the kanban add input programmatically */
export function focusKanbanAddInput(): void {
  const input = document.querySelector('.kanban-add-input') as HTMLInputElement;
  input?.focus();
}
