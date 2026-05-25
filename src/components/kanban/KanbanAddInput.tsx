import { useState, useRef, useCallback } from 'react';
import { DescriptionChipEditor, type DescriptionChipEditorHandle } from './DescriptionChipEditor';
import { Icon } from '../terminal/Icon';
import { useProjectStore } from '../../stores/projectStore';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

function SubmitHint({ withModifier }: { withModifier: boolean }) {
  return (
    <span className="kanban-add-button-hint">
      {withModifier && <Icon name={isMac ? 'command' : 'control'} className="kanban-add-button-hint-icon" />}
      <Icon name="arrow-elbow-down-left" className="kanban-add-button-hint-icon" />
    </span>
  );
}

function CancelHint() {
  return <span className="kanban-add-button-hint kanban-add-button-hint-text">Esc</span>;
}

interface KanbanAddInputProps {
  onAdd: (name: string, description?: string) => void;
}

export function KanbanAddInput({ onAdd }: KanbanAddInputProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(false);
  // Which input owns focus right now — drives the submit hint, since plain
  // Enter creates from the title field but the description needs ⌘/Ctrl+↵.
  const [focusedField, setFocusedField] = useState<'title' | 'description'>('title');
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<DescriptionChipEditorHandle>(null);

  const reset = useCallback(() => {
    setName('');
    setDescription('');
    editorRef.current?.setValue('');
    setActive(false);
    setFocusedField('title');
  }, []);

  const canSubmit = name.trim().length > 0;

  const submit = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDescription = description.trim();
    onAdd(trimmedName, trimmedDescription || undefined);
    // Clear the fields but keep the form open and focused so the next task
    // can be typed immediately without clicking back in.
    setName('');
    setDescription('');
    editorRef.current?.setValue('');
    inputRef.current?.focus();
  }, [name, description, onAdd]);

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
      // Cmd/Ctrl+Enter submits; plain Enter falls through to contentEditable's
      // native line-break handling. Escape resets the form.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        reset();
      }
    },
    [submit, reset],
  );

  const handleDescriptionFocus = useCallback(() => setFocusedField('description'), []);
  const handleNameFocus = useCallback(() => {
    setActive(true);
    setFocusedField('title');
  }, []);

  // Collapse only when focus leaves the whole form and nothing was entered.
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const nextFocus = e.relatedTarget as Node | null;
      if (nextFocus && e.currentTarget.contains(nextFocus)) return;
      if (!name.trim() && !description.trim()) setActive(false);
    },
    [name, description],
  );

  const handleAttachFile = useCallback(async (file: File): Promise<string | null> => {
    // Prefer the file's existing on-disk path — drag-drop from Finder and
    // most clipboard file pastes already have one. Skipping the copy keeps
    // the user's file under their control and works for any extension.
    const existingPath = window.api.getPathForFile(file);
    if (existingPath) return existingPath;

    // No source path — bytes only (typically a clipboard-pasted screenshot).
    // Save those to userData so CLI agents have a stable path to read.
    if (!file.type.startsWith('image/')) {
      useProjectStore.getState().addToast('Only image clipboard content can be attached', 'error');
      return null;
    }
    const ext = file.type.split('/')[1] || 'png';
    const data = new Uint8Array(await file.arrayBuffer());
    const result = await window.api.task.saveAttachment(data, ext);
    if (result.success && result.path) return result.path;
    useProjectStore.getState().addToast(result.error || 'Failed to attach image', 'error');
    return null;
  }, []);

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
        onFocus={handleNameFocus}
      />
      {active && (
        <>
          <DescriptionChipEditor
            ref={editorRef}
            initialValue=""
            onChange={setDescription}
            onAttachFile={handleAttachFile}
            placeholder="Description (optional)"
            onKeyDown={handleDescriptionKeyDown}
            onFocus={handleDescriptionFocus}
            className="kanban-add-description w-full font-mono text-xs text-text-secondary bg-transparent px-3 py-2.5 outline-none transition-all duration-150 ease-out border-none focus:bg-white/[0.04]"
            style={{ minHeight: '4.5rem', whiteSpace: 'pre-wrap', wordWrap: 'break-word', lineHeight: 1.5 }}
          />
          {/* DOM order is [Create, Cancel] so Tab from the description lands
              on Create first; flex-row-reverse keeps Cancel on the visual left. */}
          <div
            className="flex flex-row-reverse items-center justify-start gap-2 px-2 py-1.5"
            style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
          >
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="kanban-add-button text-accent hover:bg-accent/10 disabled:text-text-tertiary"
            >
              Create
              <SubmitHint withModifier={focusedField === 'description'} />
            </button>
            <button
              type="button"
              onClick={reset}
              className="kanban-add-button text-text-tertiary hover:text-text-primary hover:bg-white/[0.04]"
            >
              Cancel
              <CancelHint />
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
