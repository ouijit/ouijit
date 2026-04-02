import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { TaskWithWorkspace } from '../../types';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';

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
  const [editorHookDialog, setEditorHookDialog] = useState(false);
  const [terminalContextMenu, setTerminalContextMenu] = useState<{ x: number; y: number; ptyId: string } | null>(null);
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const terminalRenameRef = useRef<HTMLInputElement>(null);
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

  const commitTerminalRename = useCallback(() => {
    const value = terminalRenameRef.current?.value.trim();
    if (value && renamingTerminalId) {
      useTerminalStore.getState().updateDisplay(renamingTerminalId, { label: value });
    }
    setRenamingTerminalId(null);
  }, [renamingTerminalId]);

  useEffect(() => {
    if (renamingTerminalId && terminalRenameRef.current) {
      const display = useTerminalStore.getState().displayStates[renamingTerminalId];
      terminalRenameRef.current.value = display?.label ?? '';
      terminalRenameRef.current.focus();
      terminalRenameRef.current.select();
    }
  }, [renamingTerminalId]);

  const terminalContextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!terminalContextMenu) return [];
    return [
      {
        label: 'Rename',
        icon: 'pencil-simple',
        onClick: () => setRenamingTerminalId(terminalContextMenu.ptyId),
      },
    ];
  }, [terminalContextMenu]);

  const formattedDate = task.createdAt
    ? new Date(task.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [hasEditorHook, setHasEditorHook] = useState(false);
  useEffect(() => {
    window.api.lima.status(projectPath).then((s) => setSandboxAvailable(s.available));
    window.api.hooks.get(projectPath).then((hooks) => setHasEditorHook(!!(hooks as any).editor));
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

    // Open in terminal (always available — creates worktree if needed)
    items.push({
      label: 'Open in Terminal',
      icon: 'terminal',
      onClick: () => onOpenTerminal(task),
    });

    // Open in sandbox (only when worktree exists and lima available)
    if (task.worktreePath && task.branch && sandboxAvailable) {
      items.push({
        label: 'Open in Sandbox',
        icon: 'cube',
        onClick: () => onOpenTerminal(task, true),
      });
    }

    // Open in editor (always visible — prompts config dialog if not set up)
    items.push({
      label: 'Open in Editor',
      icon: 'code',
      onClick: () => {
        if (hasEditorHook && task.worktreePath) {
          window.api.openInEditor(projectPath, task.worktreePath);
        } else {
          setEditorHookDialog(true);
        }
      },
    });

    // View Plan (if any connected terminal has a plan)
    const planDisplay = connectedDisplays.find((d) => d.planPath);
    if (planDisplay) {
      items.push({
        label: 'View Plan',
        icon: 'list-checks',
        onClick: () => {
          // Switch to the terminal and open its plan panel
          onSwitchToTerminal(planDisplay.ptyId);
          const inst = terminalInstances.get(planDisplay.ptyId);
          if (inst && !inst.planPanelOpen) {
            inst.planPanelOpen = true;
            inst.diffPanelOpen = false;
            inst.runnerPanelOpen = false;
            inst.pushDisplayState({ planPanelOpen: true, diffPanelOpen: false, runnerPanelOpen: false });
          }
        },
      });
    }

    items.push({ separator: true });

    // Rename
    items.push({
      label: 'Rename',
      icon: 'pencil-simple',
      onClick: () => startEditing(),
    });

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
  }, [
    connectedDisplays,
    task,
    projectPath,
    isDone,
    sandboxAvailable,
    hasEditorHook,
    startEditing,
    onSwitchToTerminal,
    onOpenTerminal,
  ]);

  return (
    <div
      className="kanban-card group px-3 py-3.5 ease-out [-webkit-app-region:no-drag] hover:bg-black/10 active:bg-black/[0.12]"
      style={{
        background: expanded ? 'rgba(0, 0, 0, 0.15)' : 'var(--color-terminal-bg)',
        transition: 'background 150ms ease-out, opacity 150ms ease-out',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
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
      {editorHookDialog && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType="editor"
          onClose={(result) => {
            setEditorHookDialog(false);
            if (result?.saved) setHasEditorHook(true);
          }}
        />
      )}
      <div className="flex items-start gap-2">
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

      {/* Connected terminal status dots */}
      {connectedDisplays.length > 0 && (
        <div className="flex flex-col" style={{ paddingTop: 3 }}>
          {connectedDisplays.map((display, i) => {
            const isLast = i === connectedDisplays.length - 1;
            const isRenaming = renamingTerminalId === display.ptyId;
            const dotLabel = display.lastOscTitle || display.label || 'Shell';
            const truncated = dotLabel.length > 35 ? dotLabel.slice(0, 35) + '\u2026' : dotLabel;

            return (
              <div
                key={display.ptyId}
                className="flex flex-row items-center gap-1.5 hover:bg-white/[0.06] active:bg-white/[0.03]"
                style={{ padding: '3px 2px', borderRadius: 3, transition: 'background 0.1s ease' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSwitchToTerminal(display.ptyId);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTerminalContextMenu({ x: e.clientX, y: e.clientY, ptyId: display.ptyId });
                }}
              >
                <span className="font-mono text-sm leading-none text-text-secondary shrink-0 select-none opacity-40">
                  {isLast ? '\u2514\u2500' : '\u251C\u2500'}
                </span>
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${display.summaryType === 'thinking' ? 'bg-[#da77f2]' : 'bg-[#69db7c]'}`}
                  style={{
                    ...(display.summaryType === 'thinking'
                      ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' }
                      : {}),
                    ...(display.sandboxed
                      ? { outline: '1.5px solid rgba(116, 192, 252, 0.6)', outlineOffset: '1.5px' }
                      : {}),
                  }}
                />
                {isRenaming ? (
                  <input
                    ref={terminalRenameRef}
                    className="font-mono text-[10px] leading-tight text-text-secondary bg-transparent border-0 border-b border-accent p-0 outline-none min-w-0 [-webkit-app-region:no-drag]"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitTerminalRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitTerminalRename();
                      if (e.key === 'Escape') setRenamingTerminalId(null);
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
      {terminalContextMenu && (
        <ContextMenu
          x={terminalContextMenu.x}
          y={terminalContextMenu.y}
          items={terminalContextMenuItems}
          onClose={() => setTerminalContextMenu(null)}
        />
      )}

      {/* Detail section */}
      {expanded && (
        <div className="grid mt-2 pt-2 border-t border-white/[0.04] gap-2">
          <div className="flex flex-col gap-1 text-sm">
            <span
              ref={descInputRef}
              className={`text-text-secondary truncate cursor-text${editingDesc ? ' outline-none' : ''}${!task.prompt && !editingDesc ? ' text-text-tertiary italic transition-colors duration-150 ease-out hover:text-text-secondary' : ''}`}
              style={editingDesc ? { whiteSpace: 'pre-wrap', wordWrap: 'break-word', lineHeight: 1.5 } : undefined}
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
