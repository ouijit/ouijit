import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { TaskWithWorkspace } from '../../types';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';

interface KanbanCardProps {
  task: TaskWithWorkspace;
  projectPath: string;
  onRename: (taskNumber: number, newName: string) => void;
  onUpdateDescription: (taskNumber: number, description: string) => void;
  onOpenTerminal: (task: TaskWithWorkspace, sandboxed?: boolean) => void;
  onSwitchToTerminal: (ptyId: string) => void;
}

export const KanbanCard = memo(function KanbanCard({
  task,
  projectPath,
  onRename,
  onUpdateDescription,
  onOpenTerminal,
  onSwitchToTerminal,
}: KanbanCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const nameInputRef = useRef<HTMLTextAreaElement>(null);
  const descInputRef = useRef<HTMLSpanElement>(null);

  const isDone = task.status === 'done';

  // Find connected terminals for this task (reactive — re-renders when display states change)
  const displayStates = useTerminalStore((s) => s.displayStates);
  const terminalPtyIds = useTerminalStore((s) => s.terminalsByProject[projectPath]);
  const connectedDisplays = useMemo(() => {
    const result: TerminalDisplayState[] = [];
    const ids = terminalPtyIds ?? [];
    for (const ptyId of ids) {
      const display = displayStates[ptyId];
      if (display?.taskId === task.taskNumber) {
        result.push(display);
      }
    }
    return result;
  }, [displayStates, terminalPtyIds, task.taskNumber]);

  // Handle inline name editing
  const startEditing = useCallback(() => {
    setEditing(true);
  }, []);

  useEffect(() => {
    if (editing && nameInputRef.current) {
      nameInputRef.current.value = task.name;
      nameInputRef.current.focus();
      nameInputRef.current.select();
      // Auto-height
      nameInputRef.current.style.height = 'auto';
      nameInputRef.current.style.height = `${nameInputRef.current.scrollHeight}px`;
    }
  }, [editing, task.name]);

  const commitRename = useCallback(() => {
    if (!nameInputRef.current) return;
    const newName = nameInputRef.current.value.trim();
    if (newName && newName !== task.name) {
      onRename(task.taskNumber, newName);
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

  // Handle description editing
  const commitDescription = useCallback(() => {
    if (!descInputRef.current) return;
    const desc = descInputRef.current.textContent?.trim() || '';
    onUpdateDescription(task.taskNumber, desc);
    setEditingDesc(false);
  }, [task.taskNumber, onUpdateDescription]);

  const formattedDate = task.createdAt
    ? new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  useEffect(() => {
    window.api.lima.status(projectPath).then((s) => setSandboxAvailable(s.available));
  }, [projectPath]);

  // Build context menu items
  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [];

    // Connected terminals
    for (const display of connectedDisplays) {
      items.push({
        label: display.lastOscTitle || display.label || 'Shell',
        onClick: () => onSwitchToTerminal(display.ptyId),
      });
    }
    if (connectedDisplays.length > 0) {
      items.push({ separator: true });
    }

    // Open in terminal
    if (task.worktreePath && task.branch) {
      items.push({
        label: 'Open in Terminal',
        icon: 'terminal',
        onClick: () => onOpenTerminal(task),
      });

      // Open in sandbox
      if (sandboxAvailable) {
        items.push({
          label: 'Open in Sandbox',
          icon: 'cube',
          onClick: () => onOpenTerminal(task, true),
        });
      }
    }

    // Open in editor
    if (task.worktreePath) {
      items.push({
        label: 'Open in Editor',
        icon: 'code',
        onClick: () => {
          window.api.openInEditor(projectPath, task.worktreePath!);
        },
      });
    }

    items.push({ separator: true });

    // Close/Reopen
    if (isDone) {
      items.push({
        label: 'Reopen',
        icon: 'arrow-counter-clockwise',
        onClick: async () => {
          await window.api.task.setStatus(projectPath, task.taskNumber, 'in_progress');
          useProjectStore.getState().loadTasks(projectPath);
        },
      });
    } else {
      items.push({
        label: 'Move to Done',
        icon: 'archive',
        onClick: async () => {
          await window.api.task.setStatus(projectPath, task.taskNumber, 'done');
          useProjectStore.getState().loadTasks(projectPath);
        },
      });
    }

    // Delete
    items.push({
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        await window.api.task.trash(projectPath, task.taskNumber);
        useProjectStore.getState().loadTasks(projectPath);
        useProjectStore.getState().addToast('Task deleted', 'success');
      },
    });

    return items;
  }, [connectedDisplays, task, projectPath, isDone, sandboxAvailable, onSwitchToTerminal, onOpenTerminal]);

  return (
    <div
      className={`kanban-card${isDone ? ' kanban-card--done' : ''}${expanded ? ' kanban-card--expanded' : ''}`}
      data-task-number={task.taskNumber}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      <div className="kanban-card-header">
        {editing ? (
          <textarea
            ref={nameInputRef}
            className="kanban-card-name-input"
            onBlur={commitRename}
            onKeyDown={handleNameKeyDown}
            rows={1}
          />
        ) : (
          <span className="kanban-card-name" onDoubleClick={startEditing}>
            {task.name}
          </span>
        )}
        <button
          className={`kanban-card-expand${expanded ? ' kanban-card-expand--open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          <Icon name="caret-down" />
        </button>
      </div>

      {/* Connected terminal status dots */}
      {connectedDisplays.length > 0 && (
        <div className="kanban-card-status-tree">
          {connectedDisplays.map((display, i) => {
            const isLast = i === connectedDisplays.length - 1;
            const dotLabel = display.lastOscTitle || display.label || 'Shell';
            const truncated = dotLabel.length > 35 ? dotLabel.slice(0, 35) + '\u2026' : dotLabel;

            return (
              <div
                key={display.ptyId}
                className="kanban-card-status-row"
                onClick={(e) => {
                  e.stopPropagation();
                  onSwitchToTerminal(display.ptyId);
                }}
              >
                <span className="kanban-card-status-elbow">{isLast ? '\u2514\u2500' : '\u251C\u2500'}</span>
                <span
                  className={`kanban-card-status-dot${display.sandboxed ? ' kanban-card-status-dot--sandboxed' : ''}`}
                  data-status={display.summaryType}
                />
                <span className="kanban-card-status-label">
                  {truncated}
                  {display.sandboxed ? ' (sandbox)' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail section */}
      {expanded && (
        <div className="kanban-card-detail kanban-card-detail--visible">
          <div className="kanban-card-detail-row">
            <span
              ref={descInputRef}
              className={`kanban-card-detail-value${editingDesc ? ' kanban-card-detail-value--editing' : ''}${!task.prompt && !editingDesc ? ' kanban-card-detail-value--placeholder' : ''}`}
              contentEditable={editingDesc}
              suppressContentEditableWarning
              onClick={() => {
                if (!editingDesc) {
                  setEditingDesc(true);
                  // Clear placeholder text and focus
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
              {task.prompt || (editingDesc ? '' : 'Add description\u2026')}
            </span>
          </div>
          {task.branch && (
            <div className="kanban-card-branch">
              <Icon name="git-branch" />
              <span className="kanban-card-branch-name">{task.branch}</span>
            </div>
          )}
          {formattedDate && <div className="kanban-card-detail-row">Created {formattedDate}</div>}
        </div>
      )}
    </div>
  );
});
