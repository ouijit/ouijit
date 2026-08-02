import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DescriptionChipEditor, type DescriptionChipEditorHandle } from './DescriptionChipEditor';
import { Icon } from '../terminal/Icon';
import { KeyHint } from '../ui/KeyHint';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
const MOD = isMac ? '⌘' : 'Ctrl ';

/** Matches the palette's enter/exit so the two overlays feel like siblings. */
const TRANSITION_MS = 200;

interface TaskComposerSheetProps {
  /** Storage-format description the sheet opens with. */
  description: string;
  /** Task name. Editable in `create` mode, shown as context in `edit`. */
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
 * The composer's expanded view: the same draft as the inline form, given room
 * to write in. Built on the same floating panel as the command palette —
 * top-anchored so it grows downward under a fixed header, glass-beveled, on
 * the terminal surface — because this is a writing surface the user chose to
 * open, not a dialog interrupting them.
 *
 * Both editors are views onto one piece of state held by the parent, so moving
 * between them is a change of surface rather than a handoff, including the
 * caret, which travels as an offset into the storage string.
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
  const [visible, setVisible] = useState(false);
  const editorRef = useRef<DescriptionChipEditorHandle>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const isCreate = mode === 'create';
  const canSubmit = !isCreate || (name ?? '').trim().length > 0;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  /** Play the exit before handing control back, like the app's other overlays. */
  const dismiss = useCallback((run: () => void) => {
    setVisible(false);
    setTimeout(run, TRANSITION_MS);
  }, []);

  const collapse = useCallback(() => {
    const caret = editorRef.current?.getCaret() ?? null;
    dismiss(() => onCollapse(caret));
  }, [dismiss, onCollapse]);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    dismiss(onSubmit);
  }, [canSubmit, dismiss, onSubmit]);

  // Land where the inline editor left off. An empty name in create mode means
  // this is a fresh draft, so start there instead of in the description.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (isCreate && !(name ?? '').trim()) {
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
      if (e.key === 'Escape' || (mod && e.key.toLowerCase() === 'e')) {
        e.preventDefault();
        e.stopPropagation();
        collapse();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [collapse, submit]);

  return createPortal(
    <div
      data-testid="composer-sheet-overlay"
      data-visible={visible}
      className={`fixed inset-0 z-[10003] flex justify-center px-6 pt-[12vh] pb-10 transition-opacity duration-200 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) collapse();
      }}
    >
      <div
        data-testid="composer-sheet"
        className={`glass-bevel w-full max-w-[40rem] max-h-full flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2'
        }`}
        style={{
          background: 'var(--color-terminal-bg)',
          boxShadow: 'var(--shadow-panel)',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        }}
      >
        {/* Name row, styled as the card name it becomes. */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/[0.06] shrink-0">
          <span className="shrink-0 text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
            <Icon name={isCreate ? 'file-plus' : 'pencil-simple'} />
          </span>
          {isCreate ? (
            <input
              ref={nameRef}
              type="text"
              value={name ?? ''}
              onChange={(e) => onNameChange?.(e.target.value)}
              onKeyDown={(e) => {
                // Enter moves on rather than submitting: at this size the
                // description is almost certainly the point.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editorRef.current?.focus();
                }
              }}
              placeholder="Task name"
              spellCheck={false}
              aria-label="Task name"
              className="flex-1 min-w-0 bg-transparent border-none outline-none font-mono text-sm font-medium text-text-primary placeholder:text-text-tertiary"
            />
          ) : (
            <span className="flex-1 min-w-0 truncate font-mono text-sm font-medium text-text-primary">{name}</span>
          )}
          <span className="shrink-0 text-[11px] text-ink/40">{isCreate ? 'Todo' : 'Description'}</span>
        </div>

        {/* The writing surface. Padding is generous on purpose: it sets the
            measure and, being inside the editable box, stays clickable. */}
        <DescriptionChipEditor
          ref={editorRef}
          initialValue={description}
          onChange={onDescriptionChange}
          onAttachFile={onAttachFile}
          placeholder={isCreate ? 'Describe the task, or write the prompt to start from…' : 'Add a description…'}
          className="composer-sheet-editor settings-scrollable w-full overflow-y-auto px-8 pt-5 pb-6 font-mono text-[13px] text-text-primary bg-transparent outline-none border-none"
          style={{ minHeight: '13rem', maxHeight: '46vh', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
        />

        <div className="shrink-0 flex items-center gap-4 px-3 py-2 border-t border-ink/[0.06] text-[11px] text-ink/40">
          <KeyHint keys="esc" label={isCreate ? 'Draft stays in the column' : 'Back to the card'} />
          <span className="flex-1" />
          {onDiscard && (
            <button type="button" onClick={onDiscard} className="composer-sheet-action">
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="composer-sheet-action composer-sheet-action-primary"
          >
            {isCreate ? 'Create task' : 'Save'}
            <kbd>{MOD}↵</kbd>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
