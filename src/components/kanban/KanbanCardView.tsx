import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalStore';
import { Icon } from '../terminal/Icon';
import { StatusDot } from '../terminal/StatusDot';
import {
  createAttachmentChip,
  isAttachmentChip,
  parseDescription,
  serializeDescriptionDOM,
} from '../../utils/descriptionAttachments';

const DESCRIPTION_PLACEHOLDER = 'Add description…';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

export interface KanbanCardViewProps {
  task: TaskWithWorkspace;
  connectedDisplays?: TerminalDisplayState[];
  isSettingUp?: boolean;
  isSelected?: boolean;
  isHoveredBadgeTarget?: boolean;
  isValidBadgeTarget?: boolean;
  isInvalidBadgeTarget?: boolean;
  showBadge?: boolean;
  badge?: ReactNode;
  formattedDate?: string;
  onSelect?: (taskNumber: number, event: MouseEvent) => void;
  onPlainClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  onUpdateDescription?: (taskNumber: number, description: string) => void;
  /**
   * Persists a pasted image and resolves to its absolute file path (or null on
   * failure). The path is inserted into the description so CLI agents can read
   * the image when the task runs.
   */
  onSaveImage?: (data: Uint8Array, ext: string) => Promise<string | null>;
  onSwitchToTerminal?: (ptyId: string) => void;
  onTerminalContextMenu?: (ptyId: string, event: MouseEvent) => void;

  /** Controlled — when true, the View renders the name as an editable textarea. */
  isRenamingTask?: boolean;
  /** Called when the user double-clicks the name to enter rename mode. */
  onStartRenameTask?: () => void;
  /** Called on Enter or blur with a non-empty value different from the current name. */
  onCommitRenameTask?: (taskNumber: number, newName: string) => void;
  /** Called on Escape, or when blur produces no committable value. The wrapper
   *  is expected to clear `isRenamingTask` in response. */
  onCancelRenameTask?: () => void;

  /** Controlled — ptyId currently being renamed inline. View renders an input when set. */
  renamingTerminalId?: string | null;
  initialRenamingLabel?: string;
  /** Called on Enter or blur with a non-empty value. */
  onCommitRenameTerminal?: (ptyId: string, label: string) => void;
  /** Called on Escape, or when blur produces no committable value. The wrapper
   *  is expected to clear `renamingTerminalId` in response. */
  onCancelRenameTerminal?: (ptyId: string) => void;
}

/**
 * Pure presentational kanban card. Owns local UI state (expanded, editing,
 * description edit, terminal rename input). No store reads, no dnd, no
 * window.api, no context menus or dialogs — those are rendered as siblings
 * by the smart KanbanCard wrapper.
 */
export const KanbanCardView = memo(function KanbanCardView({
  task,
  connectedDisplays = [],
  isSettingUp = false,
  isSelected = false,
  isHoveredBadgeTarget = false,
  isValidBadgeTarget = false,
  isInvalidBadgeTarget = false,
  showBadge = false,
  badge,
  formattedDate,
  onSelect,
  onPlainClick,
  onContextMenu,
  onUpdateDescription,
  onSaveImage,
  onSwitchToTerminal,
  onTerminalContextMenu,
  isRenamingTask = false,
  onStartRenameTask,
  onCommitRenameTask,
  onCancelRenameTask,
  renamingTerminalId,
  initialRenamingLabel,
  onCommitRenameTerminal,
  onCancelRenameTerminal,
}: KanbanCardViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const nameInputRef = useRef<HTMLTextAreaElement>(null);
  const descInputRef = useRef<HTMLSpanElement>(null);
  const terminalRenameRef = useRef<HTMLInputElement>(null);

  const isDone = task.status === 'done';

  useEffect(() => {
    if (isRenamingTask && nameInputRef.current) {
      nameInputRef.current.value = task.name;
      nameInputRef.current.focus();
      nameInputRef.current.select();
      nameInputRef.current.style.height = 'auto';
      nameInputRef.current.style.height = `${nameInputRef.current.scrollHeight}px`;
    }
  }, [isRenamingTask, task.name]);

  const commitRename = useCallback(() => {
    if (!nameInputRef.current) {
      onCancelRenameTask?.();
      return;
    }
    const newName = nameInputRef.current.value.trim();
    if (newName && newName !== task.name) {
      onCommitRenameTask?.(task.taskNumber, newName);
    } else {
      onCancelRenameTask?.();
    }
  }, [task.taskNumber, task.name, onCommitRenameTask, onCancelRenameTask]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        onCancelRenameTask?.();
      }
    },
    [commitRename, onCancelRenameTask],
  );

  const commitDescription = useCallback(() => {
    if (!descInputRef.current) return;
    const desc = serializeDescriptionDOM(descInputRef.current);
    onUpdateDescription?.(task.taskNumber, desc);
    setEditingDesc(false);
  }, [task.taskNumber, onUpdateDescription]);

  /**
   * Sync the contentEditable DOM with `task.prompt`. Fires when the prompt
   * changes or when the editor (re-)mounts via the expand toggle — the span
   * only exists while the card is expanded, so the ref is null on the first
   * render and we need this effect to run again when it actually attaches.
   * Attachments are rendered as inline chips at the paste positions.
   */
  useEffect(() => {
    const el = descInputRef.current;
    if (!el) return;
    el.innerHTML = '';
    for (const seg of parseDescription(task.prompt ?? '')) {
      if (seg.type === 'text') {
        el.appendChild(document.createTextNode(seg.value));
      } else {
        el.appendChild(createAttachmentChip(seg.path));
      }
    }
    if (!task.prompt) el.textContent = DESCRIPTION_PLACEHOLDER;
  }, [task.prompt, expanded]);

  /**
   * Toggle the placeholder text on edit-state changes. Kept narrow so it never
   * touches user-authored content — only swaps between empty and the
   * placeholder string when the prompt itself is empty.
   */
  useEffect(() => {
    const el = descInputRef.current;
    if (!el || task.prompt) return;
    if (editingDesc) {
      if (el.textContent === DESCRIPTION_PLACEHOLDER) el.textContent = '';
    } else if (!el.textContent || el.textContent === '') {
      el.textContent = DESCRIPTION_PLACEHOLDER;
    }
  }, [editingDesc, task.prompt]);

  /** Insert a chip into the editor at a given range, or append if no range. */
  const insertChipAtRange = useCallback((chip: HTMLElement, range: Range | null) => {
    const editor = descInputRef.current;
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
  }, []);

  /**
   * Intercept pasted images. The bytes are saved to disk and a chip element is
   * inserted at the caret. The chip survives serialization as an inline
   * `![](path)` marker — that path is what the CLI agent reads when the task
   * runs, so the image stays positional within the prompt.
   */
  const handleDescPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLSpanElement>) => {
      if (!onSaveImage) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItem = Array.from(items).find((it) => it.kind === 'file' && it.type.startsWith('image/'));
      if (!imageItem) return;

      // Block the default paste: contentEditable would embed an <img>, and
      // we own placement of the chip element instead.
      e.preventDefault();

      const file = imageItem.getAsFile();
      if (!file) return;
      const ext = imageItem.type.split('/')[1] || 'png';
      const data = new Uint8Array(await file.arrayBuffer());
      const savedPath = await onSaveImage(data, ext);
      if (!savedPath) return;

      const sel = window.getSelection();
      const range =
        sel && sel.rangeCount > 0 && descInputRef.current?.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
      insertChipAtRange(createAttachmentChip(savedPath), range);
    },
    [onSaveImage, insertChipAtRange],
  );

  /**
   * Accept image files dragged onto the description. If the user hasn't yet
   * entered edit mode we update the description through the normal commit
   * channel — the populate effect repaints the chip on re-render. When
   * already editing, the chip is inserted at the drop point.
   */
  const handleDescDragOver = useCallback((e: React.DragEvent<HTMLSpanElement>) => {
    const hasImage = Array.from(e.dataTransfer.items ?? []).some(
      (it) => it.kind === 'file' && it.type.startsWith('image/'),
    );
    if (!hasImage) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDescDrop = useCallback(
    async (e: React.DragEvent<HTMLSpanElement>) => {
      if (!onSaveImage) return;
      const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      // Resolve the drop point to a caret range *before* the await — the
      // hit-test API needs the live layout from the drop event.
      const docWithCaret = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      };
      let dropRange: Range | null = null;
      if (editingDesc) {
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
      }

      const savedPaths: string[] = [];
      for (const file of files) {
        const ext = file.type.split('/')[1] || 'png';
        const data = new Uint8Array(await file.arrayBuffer());
        const savedPath = await onSaveImage(data, ext);
        if (savedPath) savedPaths.push(savedPath);
      }
      if (savedPaths.length === 0) return;

      if (editingDesc) {
        for (const path of savedPaths) {
          insertChipAtRange(createAttachmentChip(path), dropRange);
        }
      } else {
        const prev = task.prompt ?? '';
        const appended = savedPaths.map((p) => `![](${p})`).join('');
        const next = prev ? `${prev} ${appended}` : appended;
        onUpdateDescription?.(task.taskNumber, next);
      }
    },
    [editingDesc, insertChipAtRange, onSaveImage, onUpdateDescription, task.prompt, task.taskNumber],
  );

  /**
   * Key handling for the description editor. Enter commits; Backspace/Delete
   * adjacent to a chip removes the entire chip in one keypress instead of
   * relying on the browser's two-step "select then delete" behaviour.
   */
  const handleDescKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitDescription();
        return;
      }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
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
      }
    },
    [commitDescription],
  );

  const commitTerminalRename = useCallback(() => {
    if (!renamingTerminalId) return;
    const value = terminalRenameRef.current?.value.trim();
    if (value) {
      onCommitRenameTerminal?.(renamingTerminalId, value);
    } else {
      // Empty/whitespace value on blur — cancel so the wrapper closes the input.
      // Without this, an empty blur leaves the rename UI stuck open.
      onCancelRenameTerminal?.(renamingTerminalId);
    }
  }, [renamingTerminalId, onCommitRenameTerminal, onCancelRenameTerminal]);

  useEffect(() => {
    if (renamingTerminalId && terminalRenameRef.current) {
      terminalRenameRef.current.value = initialRenamingLabel ?? '';
      terminalRenameRef.current.focus();
      terminalRenameRef.current.select();
    }
  }, [renamingTerminalId, initialRenamingLabel]);

  return (
    <div
      className="kanban-card group px-3 py-3.5 ease-out [-webkit-app-region:no-drag] hover:bg-black/10 active:bg-black/[0.12]"
      style={{
        background: isSelected
          ? 'rgba(10, 132, 255, 0.06)'
          : isHoveredBadgeTarget
            ? 'rgba(10, 132, 255, 0.08)'
            : expanded
              ? 'rgba(0, 0, 0, 0.15)'
              : 'var(--color-terminal-bg)',
        transition:
          'background 150ms ease-out, opacity 150ms ease-out, outline-color 150ms ease-out, box-shadow 150ms ease-out',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        outline: isHoveredBadgeTarget
          ? '1px solid rgba(10, 132, 255, 0.6)'
          : isValidBadgeTarget
            ? '1px dashed rgba(10, 132, 255, 0.3)'
            : 'none',
        outlineOffset: -1,
        ...(isInvalidBadgeTarget && { opacity: 0.4 }),
        ...(isSelected && { boxShadow: 'inset 2px 0 0 0 #0A84FF' }),
      }}
      data-task-number={task.taskNumber}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.detail >= 2) return;
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod || e.shiftKey) {
          e.stopPropagation();
          onSelect?.(task.taskNumber, e);
        } else {
          onPlainClick?.();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(e);
      }}
    >
      <div className="flex items-start gap-2">
        {isSettingUp && (
          <span
            className="w-2 h-2 rounded-full bg-transparent border-[1.5px] border-white/30 border-t-white/80 shrink-0 mt-[5px]"
            style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
          />
        )}
        {isRenamingTask ? (
          <textarea
            ref={nameInputRef}
            className="flex-1 font-mono text-sm font-medium text-text-primary bg-transparent border-0 border-b border-accent p-0 outline-none min-w-0 resize-none overflow-hidden [-webkit-app-region:no-drag] break-words"
            onBlur={commitRename}
            onKeyDown={handleNameKeyDown}
            rows={1}
          />
        ) : (
          <span
            className={`kanban-card-name flex-1 font-mono text-sm font-medium min-w-0 break-words ${isDone ? 'line-through text-text-secondary' : 'text-text-primary'}`}
            onDoubleClick={onStartRenameTask}
          >
            {task.name}
          </span>
        )}
        <button
          className={`flex items-center justify-center w-5 h-5 p-0 bg-transparent border-none rounded text-text-secondary opacity-0 transition-all duration-150 ease-out shrink-0 [-webkit-app-region:no-drag] group-hover:opacity-60 hover:!opacity-100 [&>svg]:w-3 [&>svg]:h-3 [&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-out${expanded ? ' [&>svg]:rotate-180' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          <Icon name="caret-down" />
        </button>
      </div>
      {showBadge && badge && <div className="mt-1">{badge}</div>}

      {isSettingUp && <div className="font-mono text-xs text-white/40 mt-1">Setting up workspace{'…'}</div>}

      {connectedDisplays.length > 0 && (
        <div className="flex flex-col" style={{ paddingTop: 3 }}>
          {connectedDisplays.map((display, i) => {
            const isLast = i === connectedDisplays.length - 1;
            const isRenaming = renamingTerminalId === display.ptyId;
            const dotLabel = display.lastOscTitle || display.label || 'Shell';
            const truncated = dotLabel.length > 35 ? dotLabel.slice(0, 35) + '…' : dotLabel;

            return (
              <div
                key={display.ptyId}
                className="flex flex-row items-center gap-1.5 hover:bg-white/[0.06] active:bg-white/[0.03]"
                style={{ padding: '3px 2px', borderRadius: 3, transition: 'background 0.1s ease' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSwitchToTerminal?.(display.ptyId);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTerminalContextMenu?.(display.ptyId, e);
                }}
              >
                <span className="font-mono text-sm leading-none text-text-secondary shrink-0 select-none opacity-40">
                  {isLast ? '└─' : '├─'}
                </span>
                <StatusDot summaryType={display.summaryType} sandboxed={display.sandboxed} />
                {isRenaming ? (
                  <input
                    ref={terminalRenameRef}
                    className="font-mono text-[10px] leading-tight text-text-secondary bg-transparent border-0 border-b border-accent p-0 outline-none min-w-0 [-webkit-app-region:no-drag]"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitTerminalRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitTerminalRename();
                      if (e.key === 'Escape' && renamingTerminalId) onCancelRenameTerminal?.(renamingTerminalId);
                    }}
                  />
                ) : (
                  <span className="font-mono text-[10px] leading-tight text-text-secondary truncate min-w-0">
                    {truncated}
                    {display.sandboxed ? ' (sandbox)' : ''}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {expanded && (
        <div className="grid mt-2 pt-2 border-t border-white/[0.04] gap-2">
          <div className="flex flex-col gap-1 text-sm">
            <span
              ref={descInputRef}
              className={`kanban-description-editor text-text-secondary cursor-text break-words${editingDesc ? ' outline-none' : ' line-clamp-3'}${!task.prompt && !editingDesc ? ' text-text-tertiary italic transition-colors duration-150 ease-out hover:text-text-secondary' : ''}`}
              style={editingDesc ? { whiteSpace: 'pre-wrap', wordWrap: 'break-word', lineHeight: 1.5 } : undefined}
              contentEditable={editingDesc}
              suppressContentEditableWarning
              onClick={() => {
                if (!editingDesc) {
                  setEditingDesc(true);
                  requestAnimationFrame(() => descInputRef.current?.focus());
                }
              }}
              onBlur={commitDescription}
              onPaste={handleDescPaste}
              onDragOver={handleDescDragOver}
              onDrop={handleDescDrop}
              onKeyDown={handleDescKeyDown}
            />
            {/* Content is populated imperatively in useEffect from `task.prompt` so
                the contentEditable DOM (text + attachment chips) survives unrelated
                parent re-renders without being stomped by React reconciliation. */}
          </div>
          {task.branch && (
            <div className="flex items-center gap-1 font-mono text-[13px] text-white/50 min-w-0 overflow-hidden [&>svg]:w-3 [&>svg]:h-3 [&>svg]:shrink-0">
              <Icon name="git-branch" />
              <span className="truncate min-w-0">{task.branch}</span>
            </div>
          )}
          {formattedDate && <div className="flex flex-col gap-1 text-sm">Created {formattedDate}</div>}
        </div>
      )}
    </div>
  );
});
