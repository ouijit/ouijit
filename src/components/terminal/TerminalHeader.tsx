import { Fragment, memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
  onTogglePlanPanel?: () => void;
  onToggleWebPreviewPanel?: () => void;
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
  onTogglePlanPanel,
  onToggleWebPreviewPanel,
  onToggleRunner,
}: TerminalHeaderProps) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const summary = useTerminalStore((s) => s.displayStates[ptyId]?.summary ?? '');
  const summaryType = useTerminalStore((s) => s.displayStates[ptyId]?.summaryType ?? 'ready');
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const tags = useTerminalStore((s) => s.displayStates[ptyId]?.tags) ?? EMPTY_TAGS;
  const sandboxed = useTerminalStore((s) => s.displayStates[ptyId]?.sandboxed ?? false);
  const runnerStatus = useTerminalStore((s) => s.displayStates[ptyId]?.runnerStatus ?? 'idle');
  const runnerScriptName = useTerminalStore((s) => s.displayStates[ptyId]?.runnerScriptName ?? null);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);
  const planPath = useTerminalStore((s) => s.displayStates[ptyId]?.planPath ?? null);
  const planPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.planPanelOpen ?? false);
  const webPreviewUrl = useTerminalStore((s) => s.displayStates[ptyId]?.webPreviewUrl ?? null);
  const webPreviewPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.webPreviewPanelOpen ?? false);
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
  // Subscribe to scripts from projectStore for live updates
  const storeScripts = useProjectStore((s) => s.scripts);
  const hasScripts = storeScripts.length > 0;

  useEffect(() => {
    if (projectPath) {
      window.api.lima.status(projectPath).then((s) => setSandboxAvailable(s.available));
      window.api.hooks.get(projectPath).then((h) => {
        setHasEditorHook(!!h.editor);
        setHasRunHook(!!h.run);
      });
      // Also load scripts into store if not already loaded
      if (storeScripts.length === 0) {
        useProjectStore.getState().loadScripts(projectPath);
      }
    }
  }, [projectPath, storeScripts.length]);

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
      label: 'Open Plan File',
      icon: 'list-checks',
      onClick: async () => {
        const defaultDir = instance.worktreePath || instance.projectPath;
        const result = await window.api.plan.pickFile(defaultDir);
        if (!result.canceled && result.filePath) {
          instance.planPath = result.filePath;
          instance.planPanelOpen = true;
          instance.diffPanelOpen = false;
          instance.runnerPanelOpen = false;
          instance.webPreviewPanelOpen = false;
          instance.pushDisplayState({
            planPath: result.filePath,
            planPanelOpen: true,
            diffPanelOpen: false,
            runnerPanelOpen: false,
            webPreviewPanelOpen: false,
          });
        }
      },
    });

    items.push({
      label: webPreviewUrl ? 'Open Web Preview' : 'Set Preview URL',
      icon: 'globe-simple',
      onClick: () => {
        // Open the panel. When no URL is set yet, the panel auto-focuses its
        // inline URL editor so the user can type one directly.
        if (!webPreviewPanelOpen) onToggleWebPreviewPanel?.();
      },
    });

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
  }, [
    isTaskTerminal,
    instance,
    projectPath,
    taskId,
    sandboxAvailable,
    hasEditorHook,
    onClose,
    webPreviewUrl,
    webPreviewPanelOpen,
    onToggleWebPreviewPanel,
  ]);

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

  const handlePlanClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTogglePlanPanel?.();
    },
    [onTogglePlanPanel],
  );

  const handleWebPreviewClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleWebPreviewPanel?.();
    },
    [onToggleWebPreviewPanel],
  );

  const isWorktree = taskId != null && !!worktreeBranch;
  const showChevron = runnerStatus === 'idle' && (hasRunHook || hasScripts);

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
      <div className="flex flex-col min-w-0 shrink gap-0.5">
        {/* Row 1 \u2014 identity: status + label/summary + tags */}
        <div className="group/meta flex items-center gap-2 min-w-0">
          <StatusDot summaryType={summaryType} sandboxed={sandboxed} />
          {!isActive && stackPosition != null && stackPosition <= 9 && (
            <kbd className="inline-flex items-center font-mono text-base text-white/40 shrink-0">
              {isMac ? '\u2318' : 'Ctrl+'}
              <span className="text-xs">{stackPosition}</span>
            </kbd>
          )}
          {renaming ? (
            <input
              ref={renameInputRef}
              className="font-mono text-xs font-medium text-white/85 bg-transparent border-0 border-b border-accent p-0 outline-none min-w-0 shrink-0 [-webkit-app-region:no-drag]"
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <span className="font-mono text-xs font-medium text-white/85 shrink-0">{label}</span>
          )}
          {summary && !renaming && (
            <span className="font-mono text-xs text-white/45 min-w-0 truncate">\u2014 {summary}</span>
          )}
          <span className="inline-flex items-center gap-1 min-w-0 shrink-0">
            {isActive && tagInputOpen ? (
              <TagInput ptyId={ptyId} onClose={() => setTagInputOpen(false)} />
            ) : isActive ? (
              <>
                {tags.map((tag) => (
                  <button
                    key={tag}
                    className={`${METADATA_CHIP} border-none hover:bg-white/[0.1] hover:text-white/75 transition-colors duration-150`}
                    onMouseDown={handleTagButtonClick}
                  >
                    {tag}
                  </button>
                ))}
                {tags.length === 0 && (
                  <button
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-white/35 bg-transparent border-none px-2 py-0.5 rounded-full shrink-0 opacity-0 group-hover/meta:opacity-100 hover:text-white/70 hover:bg-white/[0.05] transition-all duration-150"
                    onMouseDown={handleTagButtonClick}
                    aria-label="Add tag"
                  >
                    <Icon name="tag" className="w-3 h-3" />
                    <span>Tag</span>
                  </button>
                )}
              </>
            ) : (
              tags.map((tag) => (
                <span key={tag} className={METADATA_CHIP}>
                  {tag}
                </span>
              ))
            )}
          </span>
        </div>

        {/* Row 2 \u2014 subordinate context: branch */}
        {!compact && isActive && gitFileStatus?.branch && <BranchCopy branch={gitFileStatus.branch} />}
      </div>
      <div className="flex items-center gap-2 shrink-0 justify-end">
        {isActive && (
          <ActionGroup
            compact={compact}
            planPath={planPath}
            planPanelOpen={planPanelOpen}
            onPlanClick={handlePlanClick}
            webPreviewUrl={webPreviewUrl}
            webPreviewPanelOpen={webPreviewPanelOpen}
            onWebPreviewClick={handleWebPreviewClick}
            gitFileStatus={gitFileStatus}
            isWorktree={isWorktree}
            diffPanelOpen={diffPanelOpen}
            onDiffClick={handleDiffClick}
            runnerStatus={runnerStatus}
            runnerScriptName={runnerScriptName}
            runnerPanelOpen={runnerPanelOpen}
            showChevron={showChevron}
            onRunnerPrimaryClick={handleRunnerPrimaryClick}
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

const METADATA_CHIP =
  'inline-flex items-center gap-1 font-mono text-[11px] font-medium text-white/55 bg-white/[0.05] rounded-full px-2 py-0.5 shrink-0';

function BranchCopy({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleClick = useCallback(() => {
    void navigator.clipboard.writeText(branch).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1200);
    });
  }, [branch]);

  const iconName = copied ? 'check' : hovered ? 'copy' : 'git-branch';

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-mono text-[11px] text-white/45 bg-transparent border-none p-0 min-w-0 self-start shrink-0 transition-colors duration-150 hover:text-white/75"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon name={iconName} className="w-3 h-3 shrink-0 text-white/35" />
      <span className="truncate">{copied ? 'Copied' : branch}</span>
    </button>
  );
}

function StatusDot({ summaryType, sandboxed }: { summaryType: string; sandboxed: boolean }) {
  const isThinking = summaryType === 'thinking';
  return (
    <span
      className={`w-[9px] h-[9px] rounded-full shrink-0 transition-all duration-200 ease-out ${isThinking ? 'bg-[#da77f2]' : 'bg-[#4ee82e]'}`}
      data-status={summaryType}
      style={{
        boxShadow: isThinking
          ? '0 0 4px rgba(218, 119, 242, 0.5), inset 0 0 0 1px #000'
          : '0 0 4px rgba(78, 232, 46, 0.5), inset 0 0 0 1px #000',
        ...(isThinking ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
        ...(sandboxed ? { outline: '1.5px solid rgba(116, 192, 252, 0.6)', outlineOffset: '2px' } : {}),
      }}
    />
  );
}

// Shared button class for items inside the joined ActionGroup.
const groupButtonBase =
  'h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium transition-colors duration-150 ease-out';
const groupButtonInactive = 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary';
const groupButtonActive = 'bg-accent text-white hover:bg-accent';

function ActionGroup({
  compact,
  planPath,
  planPanelOpen,
  onPlanClick,
  webPreviewUrl,
  webPreviewPanelOpen,
  onWebPreviewClick,
  gitFileStatus,
  isWorktree,
  diffPanelOpen,
  onDiffClick,
  runnerStatus,
  runnerScriptName,
  runnerPanelOpen,
  showChevron,
  onRunnerPrimaryClick,
  onChevronClick,
  chevronRef,
}: {
  compact?: boolean;
  planPath: string | null;
  planPanelOpen: boolean;
  onPlanClick: (e: React.MouseEvent) => void;
  webPreviewUrl: string | null;
  webPreviewPanelOpen: boolean;
  onWebPreviewClick: (e: React.MouseEvent) => void;
  gitFileStatus: GitFileStatus | null;
  isWorktree: boolean;
  diffPanelOpen: boolean;
  onDiffClick: (e: React.MouseEvent) => void;
  runnerStatus: string;
  runnerScriptName: string | null;
  runnerPanelOpen: boolean;
  showChevron: boolean;
  onRunnerPrimaryClick: (e: React.MouseEvent) => void;
  onChevronClick: (e: React.MouseEvent) => void;
  chevronRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const showPlan = !compact && !!planPath;
  const showPreview = !compact && !!webPreviewUrl;

  const dirtyFileCount = gitFileStatus?.uncommittedFiles.length ?? 0;
  const insertions = gitFileStatus?.uncommittedFiles.reduce((s, f) => s + f.additions, 0) ?? 0;
  const deletions = gitFileStatus?.uncommittedFiles.reduce((s, f) => s + f.deletions, 0) ?? 0;
  const branchDiffCount = gitFileStatus?.branchDiffFiles.length ?? 0;
  const hasUncommitted = !!gitFileStatus && dirtyFileCount > 0;
  const showCompare = !!gitFileStatus && !hasUncommitted && isWorktree && branchDiffCount > 0;
  const showGit = !compact && (hasUncommitted || showCompare);

  let runText = 'Run';
  switch (runnerStatus) {
    case 'running':
      runText = runnerScriptName ?? 'Running';
      break;
    case 'success':
      runText = 'Done';
      break;
    case 'error':
      runText = 'Failed';
      break;
  }
  const runColor =
    runnerStatus === 'running' || runnerStatus === 'success'
      ? 'text-[#4ee82e] hover:text-[#76ee5c] hover:bg-background-tertiary'
      : runnerStatus === 'error'
        ? 'text-[#ff6b6b] hover:text-[#ff8e8e] hover:bg-background-tertiary'
        : groupButtonInactive;
  const runActive = runnerPanelOpen ? groupButtonActive : runColor;

  const slots: { key: string; content: React.ReactNode }[] = [];

  if (showPlan) {
    slots.push({
      key: 'plan',
      content: (
        <button
          className={`${groupButtonBase} ${planPanelOpen ? groupButtonActive : groupButtonInactive}`}
          onClick={onPlanClick}
        >
          <Icon name="list-checks" className="w-3.5 h-3.5" />
          <span>Plan</span>
        </button>
      ),
    });
  }

  if (showPreview) {
    slots.push({
      key: 'preview',
      content: (
        <button
          className={`${groupButtonBase} ${webPreviewPanelOpen ? groupButtonActive : groupButtonInactive}`}
          onClick={onWebPreviewClick}
        >
          <Icon name="globe-simple" className="w-3.5 h-3.5" />
          <span>Preview</span>
        </button>
      ),
    });
  }

  if (showGit && hasUncommitted) {
    slots.push({
      key: 'diff',
      content: (
        <button
          className={`${groupButtonBase} ${diffPanelOpen ? groupButtonActive : groupButtonInactive}`}
          onClick={onDiffClick}
        >
          <span>
            {dirtyFileCount} {dirtyFileCount === 1 ? 'file' : 'files'}
          </span>
          {insertions > 0 && <span className="text-[#4ee82e]">+{insertions}</span>}
          {deletions > 0 && <span className="text-[#ff6b6b]">-{deletions}</span>}
        </button>
      ),
    });
  } else if (showGit && showCompare) {
    slots.push({
      key: 'compare',
      content: (
        <button
          className={`${groupButtonBase} ${diffPanelOpen ? groupButtonActive : groupButtonInactive}`}
          onClick={onDiffClick}
        >
          Compare
        </button>
      ),
    });
  }

  const runIcon =
    runnerStatus === 'running' || runnerStatus === 'success' || runnerStatus === 'error' ? 'terminal' : null;

  slots.push({
    key: 'run',
    content: (
      <>
        <button className={`${groupButtonBase} ${runActive}`} data-action="run" onClick={onRunnerPrimaryClick}>
          {runIcon && <Icon name={runIcon} className="w-3.5 h-3.5" />}
          <span>{runText}</span>
        </button>
        {showChevron && (
          <button
            ref={chevronRef}
            className={`${groupButtonBase} !px-2 ${runnerPanelOpen ? groupButtonActive : runColor}`}
            aria-haspopup="menu"
            aria-label="More run options"
            onClick={onChevronClick}
          >
            <Icon name="caret-down" className="w-2.5 h-2.5" />
          </button>
        )}
      </>
    ),
  });

  return (
    <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
      {slots.map((slot, i) => (
        <Fragment key={slot.key}>
          {i > 0 && <div aria-hidden className="w-px h-3 bg-white/10 self-center" />}
          {slot.content}
        </Fragment>
      ))}
    </div>
  );
}
