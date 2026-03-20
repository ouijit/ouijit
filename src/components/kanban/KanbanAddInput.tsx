import { useState, useRef, useCallback } from 'react';

interface KanbanAddInputProps {
  onAdd: (name: string) => void;
}

export function KanbanAddInput({ onAdd }: KanbanAddInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = value.trim();
        if (name) {
          onAdd(name);
          setValue('');
        }
      } else if (e.key === 'Escape') {
        setValue('');
        inputRef.current?.blur();
      }
    },
    [value, onAdd],
  );

  return (
    <input
      ref={inputRef}
      type="text"
      className="kanban-add-input w-full font-mono text-sm font-medium text-text-primary bg-transparent px-3 py-3.5 outline-none transition-all duration-150 ease-out border-none focus:bg-white/[0.04]"
      style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
      placeholder="New task..."
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
    />
  );
}

/** Focus the kanban add input programmatically */
export function focusKanbanAddInput(): void {
  const input = document.querySelector('.kanban-add-input') as HTMLInputElement;
  input?.focus();
}
