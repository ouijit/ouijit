import { memo, useState, useCallback } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';

const EMPTY_TAGS: string[] = [];
import type { CompactGitStatus } from '../../types';
import { Icon } from './Icon';
import { TagInput } from './TagInput';

const isMac = navigator.platform.toLowerCase().includes('mac');

interface TerminalHeaderProps {
  ptyId: string;
  isActive: boolean;
  stackPosition?: number;
  onClose: () => void;
  onToggleDiffPanel?: () => void;
  onToggleRunner?: () => void;
}

export const TerminalHeader = memo(function TerminalHeader({
  ptyId,
  isActive,
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
    <div className="project-card-label">
      <div className="project-card-label-left">
        <div className="project-card-label-top">
          <span
            className={`project-card-status-dot${sandboxed ? ' project-card-status-dot--sandboxed' : ''}`}
            data-status={summaryType}
          />
          {!isActive && stackPosition != null && stackPosition <= 9 && (
            <kbd className="project-card-shortcut">
              {isMac ? '\u2318' : 'Ctrl+'}
              <span className="shortcut-number">{stackPosition}</span>
            </kbd>
          )}
          <span className="project-card-label-text">{displayText}</span>
          <button className="project-card-tag-btn" title="Tags" onMouseDown={handleTagButtonClick}>
            <Icon name="tag" />
          </button>
          <span className="project-card-tags-row">
            {tagInputOpen ? (
              <TagInput ptyId={ptyId} onClose={() => setTagInputOpen(false)} />
            ) : (
              tags.map((tag) => (
                <span key={tag} className="project-card-tag-pill">
                  {tag}
                </span>
              ))
            )}
          </span>
          {lastOscTitle && (
            <span className="project-card-osc-title" title={lastOscTitle}>
              {lastOscTitle}
            </span>
          )}
        </div>
        <div className="project-card-git-branch-row">
          <GitBranch gitStatus={gitStatus} />
        </div>
      </div>
      <div className="project-card-label-right">
        <div className="project-card-git-stats-wrapper">
          <GitStats
            gitStatus={gitStatus}
            isWorktree={isWorktree}
            diffPanelOpen={diffPanelOpen}
            onClick={handleDiffClick}
          />
        </div>
        {isActive && (
          <RunnerPill runnerStatus={runnerStatus} runnerPanelOpen={runnerPanelOpen} onClick={handleRunnerClick} />
        )}
        <button className="project-card-close" title="Close terminal" onClick={handleCloseClick}>
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
