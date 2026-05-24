import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import {
  createAttachmentChip,
  isAttachmentChip,
  parseDescription,
  serializeDescriptionDOM,
} from '../../utils/descriptionAttachments';

export interface DescriptionChipEditorHandle {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
}

export interface DescriptionChipEditorProps {
  /** Initial storage-format value (text + `![](path)` markers). */
  initialValue?: string;
  /** Fires on every edit with the current serialized value. */
  onChange?: (value: string) => void;
  /**
   * Resolve a pasted/dropped file to the absolute path that goes into the
   * prompt as a chip. The caller decides whether to use the file's existing
   * on-disk path (drag-drop from the filesystem) or save the bytes somewhere
   * first (clipboard paste of raw image data). Returning null skips the file.
   */
  onAttachFile?: (file: File) => Promise<string | null>;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Defaults to true. */
  editable?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLDivElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * Uncontrolled contentEditable that renders task descriptions with inline
 * image attachment chips. The DOM is the source of truth between explicit
 * resets via the imperative handle; `onChange` mirrors every edit so a parent
 * holding the value in state stays in sync. Re-render is safe because no
 * children are passed to the editable div — React never touches its content.
 */
export const DescriptionChipEditor = forwardRef<DescriptionChipEditorHandle, DescriptionChipEditorProps>(
  function DescriptionChipEditor(
    {
      initialValue = '',
      onChange,
      onAttachFile,
      placeholder,
      className,
      style,
      editable = true,
      autoFocus = false,
      onKeyDown,
      onBlur,
      onFocus,
      onClick,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);

    const populate = useCallback((value: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = '';
      for (const seg of parseDescription(value)) {
        if (seg.type === 'text') el.appendChild(document.createTextNode(seg.value));
        else el.appendChild(createAttachmentChip(seg.path));
      }
      el.dataset.empty = value.length === 0 ? 'true' : 'false';
    }, []);

    // Initial populate on mount. The editor is uncontrolled afterwards —
    // external resets go through the imperative `setValue` handle.
    useEffect(() => {
      populate(initialValue);
      if (autoFocus) editorRef.current?.focus();
      // Intentionally only on mount: subsequent prop changes don't repopulate.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const emitChange = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;
      const serialized = serializeDescriptionDOM(el);
      el.dataset.empty = serialized.length === 0 ? 'true' : 'false';
      onChange?.(serialized);
    }, [onChange]);

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => (editorRef.current ? serializeDescriptionDOM(editorRef.current) : ''),
        setValue: (value: string) => populate(value),
        focus: () => editorRef.current?.focus(),
      }),
      [populate],
    );

    const insertChipAtRange = useCallback(
      (chip: HTMLElement, range: Range | null) => {
        const editor = editorRef.current;
        if (!editor) return;
        if (range && editor.contains(range.startContainer)) {
          range.deleteContents();
          range.insertNode(chip);
          range.setStartAfter(chip);
          range.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } else {
          editor.appendChild(chip);
        }
        emitChange();
      },
      [emitChange],
    );

    const handlePaste = useCallback(
      async (e: React.ClipboardEvent<HTMLDivElement>) => {
        if (!onAttachFile) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const fileItem = Array.from(items).find((it) => it.kind === 'file');
        if (!fileItem) return;
        // Block default paste — contentEditable would embed an <img>, and
        // we own placement of the chip element instead.
        e.preventDefault();

        const file = fileItem.getAsFile();
        if (!file) return;
        const path = await onAttachFile(file);
        if (!path) return;

        const sel = window.getSelection();
        const range =
          sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
        insertChipAtRange(createAttachmentChip(path), range);
      },
      [onAttachFile, insertChipAtRange],
    );

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
      const hasFile = Array.from(e.dataTransfer.items ?? []).some((it) => it.kind === 'file');
      if (!hasFile) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDrop = useCallback(
      async (e: React.DragEvent<HTMLDivElement>) => {
        if (!onAttachFile) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();

        // Resolve the drop point to a caret range *before* the await — the
        // hit-test API needs the live layout from the drop event.
        const docWithCaret = document as Document & {
          caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        };
        let dropRange: Range | null = null;
        if (docWithCaret.caretPositionFromPoint) {
          const pos = docWithCaret.caretPositionFromPoint(e.clientX, e.clientY);
          if (pos) {
            dropRange = document.createRange();
            dropRange.setStart(pos.offsetNode, pos.offset);
            dropRange.collapse(true);
          }
        } else if (document.caretRangeFromPoint) {
          dropRange = document.caretRangeFromPoint(e.clientX, e.clientY);
        }

        const paths: string[] = [];
        for (const file of files) {
          const path = await onAttachFile(file);
          if (path) paths.push(path);
        }
        for (const path of paths) {
          insertChipAtRange(createAttachmentChip(path), dropRange);
        }
      },
      [onAttachFile, insertChipAtRange],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Chip-aware Backspace/Delete: remove the whole chip in one keypress
        // instead of the browser's two-step "select then delete" behaviour.
        if (e.key === 'Backspace' || e.key === 'Delete') {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            const { startContainer: sc, startOffset: so } = range;
            let adjacent: Node | null = null;
            if (e.key === 'Backspace') {
              if (sc.nodeType === Node.TEXT_NODE && so === 0) adjacent = sc.previousSibling;
              else if (sc.nodeType === Node.ELEMENT_NODE) adjacent = (sc as Element).childNodes[so - 1] ?? null;
            } else {
              const len = sc.nodeType === Node.TEXT_NODE ? (sc.textContent?.length ?? 0) : 0;
              if (sc.nodeType === Node.TEXT_NODE && so === len) adjacent = sc.nextSibling;
              else if (sc.nodeType === Node.ELEMENT_NODE) adjacent = (sc as Element).childNodes[so] ?? null;
            }
            if (isAttachmentChip(adjacent)) {
              e.preventDefault();
              adjacent.remove();
              emitChange();
              return;
            }
          }
        }
        onKeyDown?.(e);
      },
      [onKeyDown, emitChange],
    );

    return (
      <div
        ref={editorRef}
        className={`kanban-description-editor ${className ?? ''}`}
        style={style}
        contentEditable={editable}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ''}
        data-empty={initialValue.length === 0 ? 'true' : 'false'}
        onInput={emitChange}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
        onClick={onClick}
      />
    );
  },
);
