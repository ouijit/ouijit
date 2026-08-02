import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DescriptionChipEditor, type DescriptionChipEditorHandle } from './DescriptionChipEditor';
import { Icon } from '../terminal/Icon';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

interface TaskComposerSheetProps {
  /** Storage-format description the sheet opens with. */
  description: string;
  /** Task name. Omitted in `edit` mode, where the name is renamed on the card. */
  name?: string;
  /** Caret offset to restore, carried over from the inline editor. */
  initialCaret?: number | null;
  mode: 'create' | 'edit';
  onNameChange?: (name: string) => void;
  /** Fires on every keystroke so the inline editor behind the scrim stays in step. */
  onDescriptionChange: (description: string) => void;
  onAttachFile: (file: File) => Promise<string | null>;
  /** Create the task, or save the edited description. */
  onSubmit: () => void;
  /** Close and hand the caret back to the inline editor. Null when unknown. */
  onCollapse: (caret: number | null) => void;
  /** Throw the draft away. Omitted in `edit` mode. */
  onDiscard?: () => void;
}

/**
 * The composer's expanded view: the same draft as the inline form, given a
 * centered sheet and a reading measure. Both editors are views onto one piece
 * of state held by the parent, so switching between them is a change of
 * surface rather than a handoff — including the caret, which travels as an
 * offset into the storage string.
 */
export function TaskComposerSheet({
  description,
  name,
  initialCaret,
  mode,
  onNameChange,
  onDescriptionChange,
  onAttachFile,
  onSubmit,
  onCollapse,
  onDiscard,
}: TaskComposerSheetProps) {
  const editorRef = useRef<DescriptionChipEditorHandle>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const canSubmit = mode === 'edit' || (name ?? '').trim().length > 0;

  const collapse = useCallback(() => {
    onCollapse(editorRef.current?.getCaret() ?? null);
  }, [onCollapse]);

  // Land where the inline editor left off. An empty name in create mode means
  // this is a fresh draft, so start there instead of in the description.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (mode === 'create' && !(name ?? '').trim()) {
        nameRef.current?.focus();
        return;
      }
      if (initialCaret != null) editorRef.current?.focusAtCaret(initialCaret);
      else editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Only on open: later prop changes are the user's own typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture-phase so Escape closes the sheet instead of reaching the board's
  // handler, which would clear the card selection underneath.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        collapse();
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        collapse();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (canSubmit) onSubmit();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [collapse, onSubmit, canSubmit]);

  return createPortal(
    <div
      data-testid="composer-sheet-overlay"
      className="fixed inset-0 z-[10001] flex items-center justify-center p-10"
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        // Only a click that both started and ended on the scrim dismisses, so
        // a text selection dragged out of the editor doesn't close the sheet.
        if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) collapse();
      }}
    >
      <div
        data-testid="composer-sheet"
        className="kanban-composer-sheet flex flex-col w-full overflow-hidden bg-surface border border-border rounded-xl"
        style={{ maxWidth: 660, maxHeight: '100%', boxShadow: 'var(--shadow-menu)' }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        >
          <span className="kanban-composer-chip">{mode === 'create' ? 'Todo' : 'Description'}</span>
          <span className="text-xs text-text-secondary">{mode === 'create' ? 'New task' : 'Editing'}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={collapse}
            className="kanban-add-button text-text-secondary hover:text-text-primary hover:bg-ink/[0.04]"
          >
            <Icon name="arrows-in" className="w-3.5 h-3.5" />
            Collapse
            <span className="kanban-add-button-hint kanban-add-button-hint-text">{isMac ? '⌘E' : 'Ctrl E'}</span>
          </button>
        </div>

        {mode === 'create' && (
          <input
            ref={nameRef}
            type="text"
            className="w-full font-mono text-base font-medium text-text-primary bg-transparent px-5 py-4 outline-none border-none focus:bg-ink/[0.04] transition-all duration-150 ease-out"
            style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
            placeholder="Task name"
            value={name ?? ''}
            onChange={(e) => onNameChange?.(e.target.value)}
            onKeyDown={(e) => {
              // Enter moves on rather than submitting: in a sheet this size,
              // the description is almost certainly the point.
              if (e.key === 'Enter') {
                e.preventDefault();
                editorRef.current?.focus();
              }
            }}
          />
        )}

        <DescriptionChipEditor
          ref={editorRef}
          initialValue={description}
          onChange={onDescriptionChange}
          onAttachFile={onAttachFile}
          placeholder="Description, or the prompt the agent should start from…"
          className="kanban-composer-sheet-editor flex-1 w-full self-center font-mono text-[13px] text-text-primary bg-transparent outline-none border-none"
          style={{
            // A measure, so a long prompt reads as prose instead of a wall of
            // 90-character lines.
            maxWidth: '66ch',
            minHeight: 260,
            padding: '18px 0 24px',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            lineHeight: 1.65,
            overflowY: 'auto',
          }}
        />

        <div
          className="flex items-center gap-2 px-2.5 py-2 shrink-0"
          style={{ borderTop: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        >
          <span className="font-mono text-[10.5px] text-text-tertiary px-1.5">
            Drop an image anywhere in the description
          </span>
          <span className="flex-1" />
          {onDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              className="kanban-add-button text-text-tertiary hover:text-text-primary hover:bg-ink/[0.04]"
            >
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="kanban-add-button kanban-add-button-filled"
          >
            {mode === 'create' ? 'Create task' : 'Save'}
            <span className="kanban-add-button-hint kanban-add-button-hint-text">{isMac ? '⌘↵' : 'Ctrl ↵'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
