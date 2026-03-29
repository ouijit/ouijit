import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { terminalInstances } from './terminalReact';
import { addProjectTerminal } from './terminalActions';

const EMPTY_TAGS: string[] = [];
import type { GitFileStatus, RunnerScript } from '../../types';
import { Icon } from './Icon';
import { TagInput } from './TagInput';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { RunScriptDropdown } from '../scripts/RunScriptDropdown';

const isMac = navigator.platform.toLowerCase().includes('mac');

interface TerminalHeaderProps {
  ptyId: string;
  isActive: boolean;
  isBackCard?: boolean;
  compact?: boolean;
  stackPosition?: number;
  onClose: () => void;
  onToggleDiffPanel?: () => void;
  onToggleRunner?: (script?: RunnerScript) => void;
}

export const TerminalHeader = memo(function TerminalHeader({
  ptyId,
  isActive,
  isBackCard,
  compact,
  stackPosition,
  onClose,
  onToggleDiffPanel,
  onToggleRunner,
}: TerminalHeaderProps) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const summary = useTerminalStore((s) => s.displayStates[ptyId]?.summary ?? '');
  const summaryType = useTerminalStore((s) => s.displayStates[ptyId]?.summaryType ?? 'ready');
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const lastOscTitle = useTerminalStore((s) => s.displayStates[ptyId]?.lastOscTitle ?? '');
  const tags = useTerminalStore((s) => s.displayStates[ptyId]?.tags) ?? EMPTY_TAGS;
  const sandboxed = useTerminalStore((s) => s.displayStates[ptyId]?.sandboxed ?? false);
  const runnerStatus = useTerminalStore((s) => s.displayStates[ptyId]?.runnerStatus ?? 'idle');
  const runnerScriptName = useTerminalStore((s) => s.displayStates[ptyId]?.runnerScriptName ?? null);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);
  const worktreeBranch = useTerminalStore((s) => s.displayStates[ptyId]?.worktreeBranch ?? null);

  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editorHookDialog, setEditorHookDialog] = useState(false);
  const [runHookDialog, setRunHookDialog] = useState<{ killExistingOnRun?: boolean } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  const instance = terminalInstances.get(ptyId);
  const projectPath = instance?.projectPath ?? '';
  const isTaskTerminal = taskId != null;

  const scriptDropdownVisible = useUIStore((s) => s.scriptDropdownVisible && s.scriptDropdownPtyId === ptyId);

  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [hasEditorHook, setHasEditorHook] = useState(false);
  const [hasRunHook, setHasRunHook] = useState(false);
  const [hasScripts, setHasScripts] = useState(false);
  useEffect(() => {
    if (projectPath) {
      window.api.lima.status(projectPath).then((s) => setSandboxAvailable(s.available));
      window.api.hooks.get(projectPath).then((h) => {
        setHasEditorHook(!!h.editor);
        setHasRunHook(!!h.run);
      });
      window.api.scripts.getAll(projectPath).then((s) => setHasScripts(s.length > 0));
    }
  }, [projectPath]);

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!instance) return [];
    const items: ContextMenuEntry[] = [];

    if (isTaskTerminal && instance.worktreePath && instance.worktreeBranch) {
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

      // Open in editor (always visible — prompts config dialog if not set up)
      items.push({
        label: 'Open in Editor',
        icon: 'code',
        onClick: () => {
          if (hasEditorHook && instance.worktreePath) {
            window.api.openInEditor(projectPath, instance.worktreePath!);
          } else {
            setEditorHookDialog(true);
          }
        },
      });
    }

    items.push({
      label: 'Rename',
      icon: 'pencil-simple',
      onClick: () => setRenaming(true),
    });

    if (isTaskTerminal) {
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
    }

    return items;
  }, [isTaskTerminal, instance, projectPath, taskId, sandboxAvailable, hasEditorHook, onClose]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const commitRename = useCallback(() => {
    const value = renameInputRef.current?.value.trim();
    if (value) {
      useTerminalStore.getState().updateDisplay(ptyId, { label: value });
    }
    setRenaming(false);
  }, [ptyId]);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.value = label;
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming, label]);

  const handleTagButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTagInputOpen((prev) => !prev);
  }, []);

  const handleRunnerPrimaryClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onToggleRunner) return;
      // If runner already exists, just toggle the panel
      const inst = terminalInstances.get(ptyId);
      if (inst?.runner?.ptyId) {
        onToggleRunner();
        return;
      }
      // If no run hook but scripts exist, open the dropdown instead
      if (!hasRunHook && hasScripts) {
        useUIStore.getState().setScriptDropdownVisible(true, ptyId);
        return;
      }
      // Check if run hook is configured
      if (!projectPath) return;
      if (hasRunHook) {
        onToggleRunner();
      } else {
        const settings = await window.api.getProjectSettings(projectPath);
        setRunHookDialog({ killExistingOnRun: settings.killExistingOnRun });
      }
    },
    [onToggleRunner, ptyId, projectPath, hasRunHook, hasScripts],
  );

  const handleChevronClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      useUIStore.getState().setScriptDropdownVisible(!scriptDropdownVisible, ptyId);
    },
    [scriptDropdownVisible, ptyId],
  );

  const handleScriptSelect = useCallback(
    (script: RunnerScript) => {
      useUIStore.getState().setScriptDropdownVisible(false);
      onToggleRunner?.(script);
    },
    [onToggleRunner],
  );

  const handleRunHookSelect = useCallback(() => {
    useUIStore.getState().setScriptDropdownVisible(false);
    onToggleRunner?.();
  }, [onToggleRunner]);

  const handleDiffClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleDiffPanel?.();
    },
    [onToggleDiffPanel],
  );

  const displayText = summary ? `${label} \u2014 ${summary}` : label;
  const isWorktree = taskId != null && !!worktreeBranch;
  const showChevron = hasRunHook || hasScripts;

  return (
    <div
      className={`flex items-center justify-between pl-3 pr-3 ${compact || isBackCard ? 'pt-0.5 pb-1' : 'py-2'} min-h-9`}
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
      {runHookDialog && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType="run"
          killExistingOnRun={runHookDialog.killExistingOnRun}
          onClose={(result) => {
            setRunHookDialog(null);
            if (result?.saved && result.hook) {
              setHasRunHook(true);
              onToggleRunner?.();
            }
          }}
        />
      )}
      <div className="flex flex-col min-w-0 shrink">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-200 ease-out ${summaryType === 'thinking' ? 'bg-[#da77f2]' : 'bg-[#69db7c]'}`}
            data-status={summaryType}
            style={{
              boxShadow:
                summaryType === 'thinking' ? '0 0 4px rgba(218, 119, 242, 0.5)' : '0 0 4px rgba(105, 219, 124, 0.5)',
              ...(summaryType === 'thinking' ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
              ...(sandboxed ? { outline: '1.5px solid rgba(116, 192, 252, 0.6)', outlineOffset: '2px' } : {}),
            }}
          />
          {!isActive && stackPosition != null && stackPosition <= 9 && (
            <kbd className="inline-flex items-center font-mono text-base text-white/40 shrink-0">
              {isMac ? '\u2318' : 'Ctrl+'}
              <span className="text-xs">{stackPosition}</span>
            </kbd>
          )}
          {renaming ? (
            <input
              ref={renameInputRef}
              className="font-mono text-xs font-medium text-white/70 bg-transparent border-0 border-b border-accent p-0 outline-none min-w-0 shrink-0 [-webkit-app-region:no-drag]"
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <span className="font-mono text-xs font-medium text-white/70 shrink-0">{displayText}</span>
          )}
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-white/30 bg-transparent border-none shrink-0"
            onMouseDown={handleTagButtonClick}
          >
            <Icon name="tag" className="w-3.5 h-3.5" />
          </button>
          <span className="inline-flex items-center gap-1 min-w-0">
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
        {!compact && isActive && (
          <div className="min-w-0 overflow-hidden">
            <GitBranch gitFileStatus={gitFileStatus} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 justify-end">
        {!compact && isActive && (
          <div className="mr-2">
            <GitStats
              gitFileStatus={gitFileStatus}
              isWorktree={isWorktree}
              diffPanelOpen={diffPanelOpen}
              onClick={handleDiffClick}
            />
          </div>
        )}
        {isActive && (
          <RunnerPill
            runnerStatus={runnerStatus}
            runnerScriptName={runnerScriptName}
            runnerPanelOpen={runnerPanelOpen}
            showChevron={showChevron}
            onPrimaryClick={handleRunnerPrimaryClick}
            onChevronClick={handleChevronClick}
            chevronRef={chevronRef}
          />
        )}
        {scriptDropdownVisible && (
          <RunScriptDropdown
            anchorRef={chevronRef}
            projectPath={projectPath}
            hasRunHook={hasRunHook}
            onSelectScript={handleScriptSelect}
            onSelectRunHook={handleRunHookSelect}
            onClose={() => useUIStore.getState().setScriptDropdownVisible(false)}
          />
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

function GitBranch({ gitFileStatus }: { gitFileStatus: GitFileStatus | null }) {
  if (!gitFileStatus) return null;

  return (
    <span className="flex items-center gap-1 font-mono text-[13px] text-white/50 min-w-0 overflow-hidden">
      <Icon name="git-branch" className="w-3.5 h-3.5 shrink-0 text-white/40" />
      <span className="truncate min-w-0">{gitFileStatus.branch}</span>
    </span>
  );
}

function GitStats({
  gitFileStatus,
  isWorktree,
  diffPanelOpen,
  onClick,
}: {
  gitFileStatus: GitFileStatus | null;
  isWorktree: boolean;
  diffPanelOpen: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  if (!gitFileStatus) return null;

  const { uncommittedFiles, branchDiffFiles } = gitFileStatus;
  const dirtyFileCount = uncommittedFiles.length;
  const insertions = uncommittedFiles.reduce((s, f) => s + f.additions, 0);
  const deletions = uncommittedFiles.reduce((s, f) => s + f.deletions, 0);
  const hasChanges = dirtyFileCount > 0;

  if (hasChanges) {
    const fileLabel = dirtyFileCount === 1 ? 'file' : 'files';
    return (
      <button
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-mono text-[13px] font-medium text-white/60 bg-white/[0.06] transition-all duration-150 ease-out hover:bg-white/[0.12] hover:text-white/90 active:bg-white/[0.10] active:text-white/80 ${diffPanelOpen ? '!bg-accent !text-white' : ''}`}
        title="View uncommitted changes"
        onClick={onClick}
      >
        <span className="font-medium">
          {dirtyFileCount} {fileLabel}
        </span>
        {insertions > 0 && <span className="text-[#69db7c]">+{insertions}</span>}
        {deletions > 0 && <span className="text-[#ff6b6b]">-{deletions}</span>}
      </button>
    );
  }

  if (isWorktree && branchDiffFiles.length > 0) {
    return (
      <button
        className={`px-2.5 py-1 bg-white/[0.06] border-none font-sans text-[13px] font-medium text-white/60 rounded-full transition-all duration-150 ease-out hover:bg-white/[0.12] hover:text-white/90 active:bg-white/[0.10] active:text-white/80 ${diffPanelOpen ? '!bg-accent !text-white' : ''}`}
        title="Compare branch changes"
        onClick={onClick}
      >
        Compare
      </button>
    );
  }

  return null;
}

function RunnerPill({
  runnerStatus,
  runnerScriptName,
  runnerPanelOpen,
  showChevron,
  onPrimaryClick,
  onChevronClick,
  chevronRef,
}: {
  runnerStatus: string;
  runnerScriptName: string | null;
  runnerPanelOpen: boolean;
  showChevron: boolean;
  onPrimaryClick: (e: React.MouseEvent) => void;
  onChevronClick: (e: React.MouseEvent) => void;
  chevronRef: React.RefObject<HTMLButtonElement | null>;
}) {
  let text = 'Run';

  switch (runnerStatus) {
    case 'running':
      text = runnerScriptName ?? 'Running';
      break;
    case 'success':
      text = 'Done';
      break;
    case 'error':
      text = 'Failed';
      break;
  }

  const baseColors =
    runnerStatus === 'running' || runnerStatus === 'success'
      ? 'text-[#69db7c]'
      : runnerStatus === 'error'
        ? 'text-[#ff6b6b]'
        : 'text-white/60';

  const activeHighlight = runnerPanelOpen ? '!bg-accent !text-white' : '';

  if (!showChevron) {
    return (
      <button
        className={`px-2.5 py-1 bg-white/[0.06] border-none font-sans text-[13px] font-medium rounded-full transition-all duration-150 ease-out hover:bg-white/[0.12] hover:text-white/90 active:bg-white/[0.10] active:text-white/80 ${activeHighlight} ${baseColors}`}
        data-action="run"
        onClick={onPrimaryClick}
      >
        {text}
      </button>
    );
  }

  // Split button: primary action + chevron dropdown
  return (
    <div role="group" aria-label="Run options" className="inline-flex items-center rounded-full overflow-hidden">
      <button
        className={`px-2.5 py-1 bg-white/[0.06] border-none font-sans text-[13px] font-medium transition-all duration-150 ease-out hover:bg-white/[0.12] hover:text-white/90 active:bg-white/[0.10] active:text-white/80 ${activeHighlight} ${baseColors}`}
        data-action="run"
        onClick={onPrimaryClick}
      >
        {text}
      </button>
      <div className="w-px self-stretch bg-white/20" />
      <button
        ref={chevronRef}
        className={`px-1 py-1 bg-white/[0.06] border-none transition-all duration-150 ease-out hover:bg-white/[0.12] active:bg-white/[0.10] ${activeHighlight} ${baseColors} [&_svg]:w-3 [&_svg]:h-3`}
        aria-haspopup="menu"
        aria-label="More run options"
        onClick={onChevronClick}
      >
        <Icon name="caret-down" />
      </button>
    </div>
  );
}
