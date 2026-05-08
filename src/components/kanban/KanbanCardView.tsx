import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { TaskWithWorkspace } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalStore';
import { Icon } from '../terminal/Icon';
import { StatusDot } from '../terminal/StatusDot';

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
  onRename?: (taskNumber: number, newName: string) => void;
  onUpdateDescription?: (taskNumber: number, description: string) => void;
  onSwitchToTerminal?: (ptyId: string) => void;
  onTerminalContextMenu?: (ptyId: string, event: MouseEvent) => void;
  onRenameTerminal?: (ptyId: string, label: string) => void;
  /** ptyId currently being renamed inline. View renders an input when set. */
  renamingTerminalId?: string | null;
  initialRenamingLabel?: string;
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
  onRename,
  onUpdateDescription,
  onSwitchToTerminal,
  onTerminalContextMenu,
  onRenameTerminal,
  renamingTerminalId,
  initialRenamingLabel,
}: KanbanCardViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const nameInputRef = useRef<HTMLTextAreaElement>(null);
  const descInputRef = useRef<HTMLSpanElement>(null);
  const terminalRenameRef = useRef<HTMLInputElement>(null);

  const isDone = task.status === 'done';

  const startEditing = useCallback(() => {
    setEditing(true);
  }, []);

  useEffect(() => {
    if (editing && nameInputRef.current) {
      nameInputRef.current.value = task.name;
      nameInputRef.current.focus();
      nameInputRef.current.select();
      nameInputRef.current.style.height = 'auto';
      nameInputRef.current.style.height = `${nameInputRef.current.scrollHeight}px`;
    }
  }, [editing, task.name]);

  const commitRename = useCallback(() => {
    if (!nameInputRef.current) return;
    const newName = nameInputRef.current.value.trim();
    if (newName && newName !== task.name) {
      onRename?.(task.taskNumber, newName);
    }
    setEditing(false);
  }, [task.taskNumber, task.name, onRename]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        setEditing(false);
      }
    },
    [commitRename],
  );

  const commitDescription = useCallback(() => {
    if (!descInputRef.current) return;
    const desc = descInputRef.current.textContent?.trim() || '';
    onUpdateDescription?.(task.taskNumber, desc);
    setEditingDesc(false);
  }, [task.taskNumber, onUpdateDescription]);

  const commitTerminalRename = useCallback(() => {
    const value = terminalRenameRef.current?.value.trim();
    if (value && renamingTerminalId) {
      onRenameTerminal?.(renamingTerminalId, value);
    }
  }, [renamingTerminalId, onRenameTerminal]);

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
        {editing ? (
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
            onDoubleClick={startEditing}
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
                      if (e.key === 'Escape' && renamingTerminalId) onRenameTerminal?.(renamingTerminalId, '');
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
              className={`text-text-secondary cursor-text break-words${editingDesc ? ' outline-none' : ' line-clamp-3'}${!task.prompt && !editingDesc ? ' text-text-tertiary italic transition-colors duration-150 ease-out hover:text-text-secondary' : ''}`}
              style={editingDesc ? { whiteSpace: 'pre-wrap', wordWrap: 'break-word', lineHeight: 1.5 } : undefined}
              contentEditable={editingDesc}
              suppressContentEditableWarning
              onClick={() => {
                if (!editingDesc) {
                  setEditingDesc(true);
                  requestAnimationFrame(() => {
                    if (descInputRef.current && !task.prompt) {
                      descInputRef.current.textContent = '';
                    }
                    descInputRef.current?.focus();
                  });
                }
              }}
              onBlur={commitDescription}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitDescription();
                }
              }}
            >
              {task.prompt || (editingDesc ? '' : 'Add description…')}
            </span>
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
