import { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from './terminalReact';
import { addProjectTerminal } from './terminalActions';

const EMPTY_TAGS: string[] = [];
import type { CompactGitStatus } from '../../types';
import { Icon } from './Icon';
import { TagInput } from './TagInput';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';

const isMac = navigator.platform.toLowerCase().includes('mac');

interface TerminalHeaderProps {
  ptyId: string;
  isActive: boolean;
  compact?: boolean;
  stackPosition?: number;
  onClose: () => void;
  onToggleDiffPanel?: () => void;
  onToggleRunner?: () => void;
}

export const TerminalHeader = memo(function TerminalHeader({
  ptyId,
  isActive,
  compact,
  stackPosition,
  onClose,
  onToggleDiffPanel,
  onToggleRunner,
}: TerminalHeaderProps) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const summary = useTerminalStore((s) => s.displayStates[ptyId]?.summary ?? '');
  const summaryType = useTerminalStore((s) => s.displayStates[ptyId]?.summaryType ?? 'ready');
  const gitStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitStatus ?? null);
  const lastOscTitle = useTerminalStore((s) => s.displayStates[ptyId]?.lastOscTitle ?? '');
  const tags = useTerminalStore((s) => s.displayStates[ptyId]?.tags) ?? EMPTY_TAGS;
  const sandboxed = useTerminalStore((s) => s.displayStates[ptyId]?.sandboxed ?? false);
  const runnerStatus = useTerminalStore((s) => s.displayStates[ptyId]?.runnerStatus ?? 'idle');
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);
  const worktreeBranch = useTerminalStore((s) => s.displayStates[ptyId]?.worktreeBranch ?? null);

  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const instance = terminalInstances.get(ptyId);
  const projectPath = instance?.projectPath ?? '';
  const isTaskTerminal = taskId != null;

  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [hasEditorHook, setHasEditorHook] = useState(false);
  useEffect(() => {
    if (projectPath) {
      window.api.lima.status(projectPath).then((s) => setSandboxAvailable(s.available));
      window.api.hooks.get(projectPath).then((h) => setHasEditorHook(!!h.editor));
    }
  }, [projectPath]);

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!isTaskTerminal || !instance) return [];
    const items: ContextMenuEntry[] = [];

    if (instance.worktreePath && instance.worktreeBranch) {
      items.push({
        label: 'Open in Terminal',
        icon: 'terminal',
        onClick: () => {
          addProjectTerminal(projectPath, undefined, {
            existingWorktree: {
              path: instance.worktreePath!,
              branch: instance.worktreeBranch!,
              createdAt: '',
            },
            taskId: taskId!,
          });
        },
      });

      if (sandboxAvailable) {
        items.push({
          label: 'Open in Sandbox',
          icon: 'cube',
          onClick: () => {
            addProjectTerminal(projectPath, undefined, {
              existingWorktree: {
                path: instance.worktreePath!,
                branch: instance.worktreeBranch!,
                createdAt: '',
              },
              taskId: taskId!,
              sandboxed: true,
            });
          },
        });
      }
    }

    if (hasEditorHook && instance.worktreePath) {
      items.push({
        label: 'Open in Editor',
        icon: 'code',
        onClick: () => {
          window.api.openInEditor(projectPath, instance.worktreePath!);
        },
      });
    }

    items.push({ separator: true });
    items.push({
      label: 'Close Task',
      icon: 'archive',
      onClick: async () => {
        await window.api.task.setStatus(projectPath, taskId!, 'done');
        onClose();
        useProjectStore.getState().invalidateTaskList();
        useProjectStore.getState().addToast('Task closed', 'success');
      },
    });

    return items;
  }, [isTaskTerminal, instance, projectPath, taskId, sandboxAvailable, hasEditorHook, onClose]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!isTaskTerminal) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [isTaskTerminal],
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const handleTagButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTagInputOpen((prev) => !prev);
  }, []);

  const handleRunnerClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleRunner?.();
    },
    [onToggleRunner],
  );

  const handleDiffClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleDiffPanel?.();
    },
    [onToggleDiffPanel],
  );

  const displayText = summary ? `${label} \u2014 ${summary}` : label;
  const isWorktree = taskId != null && !!worktreeBranch;

  return (
    <div
      className={`flex items-center justify-between pl-3 pr-3 ${compact ? 'pt-0.5 pb-1' : 'py-2'} min-h-9`}
      onContextMenu={handleContextMenu}
    >
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      <div className="flex flex-col min-w-0 shrink">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className={`project-card-status-dot${sandboxed ? ' project-card-status-dot--sandboxed' : ''}`}
            data-status={summaryType}
          />
          {!isActive && stackPosition != null && stackPosition <= 9 && (
            <kbd className="inline-flex items-center font-mono text-base text-white/40 shrink-0">
              {isMac ? '\u2318' : 'Ctrl+'}
              <span className="text-xs">{stackPosition}</span>
            </kbd>
          )}
          <span className="font-mono text-xs font-medium text-white/70 shrink-0">{displayText}</span>
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-white/30 bg-transparent border-none shrink-0"
            onMouseDown={handleTagButtonClick}
          >
            <Icon name="tag" className="w-3.5 h-3.5" />
          </button>
          <span className="project-card-tags-row">
            {tagInputOpen ? (
              <TagInput ptyId={ptyId} onClose={() => setTagInputOpen(false)} />
            ) : (
              tags.map((tag) => (
                <span
                  key={tag}
                  className="font-mono text-[11px] text-white/50 bg-white/[0.06] rounded-full px-2 py-px shrink-0"
                >
                  {tag}
                </span>
              ))
            )}
          </span>
          {!compact && lastOscTitle && (
            <span className="font-mono text-[11px] text-white/40 bg-white/5 rounded-full px-2 py-px truncate">
              {lastOscTitle}
            </span>
          )}
        </div>
        {!compact && (
          <div className="project-card-git-branch-row">
            <GitBranch gitStatus={gitStatus} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 justify-end">
        {!compact && (
          <div className="project-card-git-stats-wrapper">
            <GitStats
              gitStatus={gitStatus}
              isWorktree={isWorktree}
              diffPanelOpen={diffPanelOpen}
              onClick={handleDiffClick}
            />
          </div>
        )}
        {isActive && (
          <RunnerPill runnerStatus={runnerStatus} runnerPanelOpen={runnerPanelOpen} onClick={handleRunnerClick} />
        )}
        <button
          className="w-7 h-7 flex items-center justify-center bg-transparent border-none text-white/40 hover:text-white/90 transition-colors duration-150 ml-1 [&_svg]:w-4 [&_svg]:h-4"
          onClick={handleCloseClick}
        >
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
});

// ── Sub-components ───────────────────────────────────────────────────

function GitBranch({ gitStatus }: { gitStatus: CompactGitStatus | null }) {
  if (!gitStatus) return null;

  return (
    <span className="project-card-git-branch">
      <Icon name="git-branch" className="project-card-git-icon" />
      <span className="project-card-git-branch-name">{gitStatus.branch}</span>
    </span>
  );
}

function GitStats({
  gitStatus,
  isWorktree,
  diffPanelOpen,
  onClick,
}: {
  gitStatus: CompactGitStatus | null;
  isWorktree: boolean;
  diffPanelOpen: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  if (!gitStatus) return null;

  const { dirtyFileCount, insertions, deletions } = gitStatus;
  const hasChanges = dirtyFileCount > 0;

  if (hasChanges) {
    const fileLabel = dirtyFileCount === 1 ? 'file' : 'files';
    return (
      <span
        className={`card-tab project-card-git-stats project-card-git-stats--clickable${diffPanelOpen ? ' card-tab--active' : ''}`}
        title="View uncommitted changes"
        onClick={onClick}
      >
        <span className="project-card-git-count">
          {dirtyFileCount} {fileLabel}
        </span>
        {insertions > 0 && <span className="project-card-git-add">+{insertions}</span>}
        {deletions > 0 && <span className="project-card-git-del">-{deletions}</span>}
      </span>
    );
  }

  if (isWorktree && gitStatus.branchDiffFileCount > 0) {
    return (
      <span
        className={`card-tab project-card-git-stats project-card-git-stats--clickable project-card-git-stats--compare${diffPanelOpen ? ' card-tab--active' : ''}`}
        title="Compare branch changes"
        onClick={onClick}
      >
        Compare
      </span>
    );
  }

  return null;
}

function RunnerPill({
  runnerStatus,
  runnerPanelOpen,
  onClick,
}: {
  runnerStatus: string;
  runnerPanelOpen: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  let text = 'Run';
  let statusClass = '';

  switch (runnerStatus) {
    case 'running':
      text = 'Running';
      statusClass = 'card-tab-run--running';
      break;
    case 'success':
      text = 'Done';
      statusClass = 'card-tab-run--success';
      break;
    case 'error':
      text = 'Failed';
      statusClass = 'card-tab-run--error';
      break;
  }

  return (
    <button
      className={`card-tab card-tab-run ${statusClass}${runnerPanelOpen ? ' card-tab--active' : ''}`}
      data-action="run"
      onClick={onClick}
    >
      {text}
    </button>
  );
}
