import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { TaskWithWorkspace } from '../../types';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';

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
  onOpenTerminal: _onOpenTerminal,
  onSwitchToTerminal,
}: KanbanCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const nameInputRef = useRef<HTMLTextAreaElement>(null);
  const descInputRef = useRef<HTMLSpanElement>(null);

  const isDone = task.status === 'done';

  // Find connected terminals for this task
  const terminalsByProject = useTerminalStore((s) => s.terminalsByProject[projectPath]) ?? [];
  const connectedTerminals = terminalsByProject.filter((ptyId) => {
    const display = useTerminalStore.getState().displayStates[ptyId];
    return display?.taskId === task.taskNumber;
  });

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

  return (
    <div
      className={`kanban-card${isDone ? ' kanban-card--done' : ''}${expanded ? ' kanban-card--expanded' : ''}`}
      data-task-number={task.taskNumber}
    >
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
      {connectedTerminals.length > 0 && (
        <div className="kanban-card-status-tree">
          {connectedTerminals.map((ptyId, i) => {
            const display = useTerminalStore.getState().displayStates[ptyId];
            const instance = terminalInstances.get(ptyId);
            const isLast = i === connectedTerminals.length - 1;
            const label = display?.lastOscTitle || instance?.command || display?.label || 'Shell';
            const truncated = label.length > 35 ? label.slice(0, 35) + '\u2026' : label;
            const isSandboxed = display?.sandboxed;

            return (
              <div
                key={ptyId}
                className="kanban-card-status-row"
                onClick={(e) => {
                  e.stopPropagation();
                  onSwitchToTerminal(ptyId);
                }}
              >
                <span className="kanban-card-status-elbow">{isLast ? '\u2514\u2500' : '\u251C\u2500'}</span>
                <span
                  className={`kanban-card-status-dot${isSandboxed ? ' kanban-card-status-dot--sandboxed' : ''}`}
                  data-status={display?.summaryType ?? 'ready'}
                />
                <span className="kanban-card-status-label">
                  {truncated}
                  {isSandboxed ? ' (sandbox)' : ''}
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
              className={`kanban-card-detail-value${editingDesc ? ' kanban-card-detail-value--editing' : ''}${!task.prompt ? ' kanban-card-detail-value--placeholder' : ''}`}
              contentEditable={editingDesc}
              suppressContentEditableWarning
              onClick={() => !editingDesc && setEditingDesc(true)}
              onBlur={commitDescription}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitDescription();
                }
              }}
            >
              {task.prompt || 'Add description\u2026'}
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
