import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DescriptionChipEditor, type DescriptionChipEditorHandle } from './DescriptionChipEditor';
import { Icon } from '../terminal/Icon';
import { KeyHint } from '../ui/KeyHint';
import { isModKey, MOD_LABEL } from '../../utils/modKey';

/** Matches the app's other overlays, so the surfaces enter and leave alike. */
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
 * The composer's expanded view, built as a document rather than a form.
 *
 * The panel is the app's floating surface, and inside it the draft is laid out
 * the way the plan panel lays out a markdown file: a chrome strip naming what
 * is open, then a page with margins holding a heading and its prose, scrolling
 * as one body.
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
  const nameRef = useRef<HTMLTextAreaElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const isCreate = mode === 'create';
  const canSubmit = !isCreate || (name ?? '').trim().length > 0;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  /**
   * Play the exit before handing control back, like the app's other overlays.
   * Latched, because the callback is deferred: without it, holding ⌘↵ queues a
   * timer per repeat and each one creates the same task again.
   */
  const dismissedRef = useRef(false);
  const dismiss = useCallback((run: () => void) => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
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

  /** Grow the title with its content — it wraps like a heading, not a field. */
  const sizeName = useCallback(() => {
    const el = nameRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Land where the inline editor left off. An empty name in create mode means
  // this is a fresh draft, so start there instead of in the description.
  useEffect(() => {
    sizeName();
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
      if (e.repeat) return;
      const mod = isModKey(e);
      // ⌘E only on the platform it belongs to: Ctrl+E is move-to-end-of-line
      // in a macOS text field.
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
      className={`fixed inset-0 z-[10003] flex items-start justify-center px-6 pt-[9vh] pb-10 transition-opacity duration-200 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) collapse();
      }}
    >
      <div
        data-testid="composer-sheet"
        className={`glass-bevel w-full max-w-[44rem] max-h-full flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2'
        }`}
        style={{
          background: 'var(--color-terminal-bg)',
          boxShadow: 'var(--shadow-panel)',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        }}
      >
        {/* Chrome strip, the way the plan panel names the file it's showing. */}
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0">
          <Icon name={isCreate ? 'file-plus' : 'file-text'} className="w-3.5 h-3.5 text-ink/50 shrink-0" />
          <span className="text-[13px] text-ink/50 truncate flex-1">{isCreate ? 'New task' : 'Description'}</span>
          <span className="text-[13px] text-ink/35 shrink-0">{isCreate ? 'Todo' : name}</span>
        </div>

        {/* The page: heading and prose in one scrolling body, with margins. */}
        <div
          ref={pageRef}
          // px-20 on a 44rem page leaves the text about three quarters of the
          // width, which is a page's proportions and holds the measure near
          // 78 characters.
          className="composer-sheet-page settings-scrollable flex-1 min-h-0 overflow-y-auto px-20 pt-8 pb-10"
          onMouseDown={(e) => {
            // Clicking the page margins puts the caret at the end, so there's
            // no dead area inside the document.
            if (e.target !== pageRef.current) return;
            e.preventDefault();
            editorRef.current?.focusAtCaret(Number.MAX_SAFE_INTEGER);
          }}
        >
          {isCreate ? (
            <textarea
              ref={nameRef}
              rows={1}
              value={name ?? ''}
              onChange={(e) => {
                onNameChange?.(e.target.value);
                sizeName();
              }}
              onKeyDown={(e) => {
                // Enter moves into the body rather than submitting: the sheet
                // is opened to write a description.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editorRef.current?.focus();
                }
              }}
              placeholder="Task name"
              spellCheck={false}
              aria-label="Task name"
              className="w-full resize-none overflow-hidden bg-transparent border-none outline-none text-lg font-semibold text-text-primary placeholder:text-text-tertiary placeholder:font-normal"
            />
          ) : (
            <h1 className="text-lg font-semibold text-text-primary">{name}</h1>
          )}

          <DescriptionChipEditor
            ref={editorRef}
            initialValue={description}
            onChange={onDescriptionChange}
            onAttachFile={onAttachFile}
            placeholder={isCreate ? 'Describe the task, or write the prompt to start from…' : 'Add a description…'}
            className="composer-sheet-editor mt-3 w-full text-sm leading-relaxed text-ink/80 bg-transparent outline-none border-none"
            style={{ minHeight: '18rem', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
          />
        </div>

        <div className="shrink-0 flex items-center gap-4 px-3 py-2 border-t border-ink/[0.06] text-[11px] text-ink/40">
          <KeyHint keys="esc" label={isCreate ? 'Draft stays in the column' : 'Back to the card'} />
          <span className="flex-1" />
          {onDiscard && (
            <button type="button" onClick={onDiscard} className="btn-secondary">
              Discard
            </button>
          )}
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary">
            {isCreate ? 'Create task' : 'Save'}
            <span className="opacity-60 font-mono text-[11px]">{MOD_LABEL}↵</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
