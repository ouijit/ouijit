import { Fragment, memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useShallow } from 'zustand/react/shallow';
import { terminalInstances } from './terminalReact';
import { addProjectTerminal, openWorktreeEditor, renameTerminal, startRunner } from './terminalActions';
import { completeTask } from '../../services/taskCompletion';

const EMPTY_TAGS: string[] = [];
const EMPTY_PANELS: TerminalPanel[] = [];
import { Icon } from './Icon';
import { TagInput } from './TagInput';
import { TerminalHeaderView, TerminalHeaderName } from './TerminalHeaderView';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { AddPanelMenu } from './AddPanelMenu';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { useTerminalPanels } from './useTerminalPanels';
import { panelIcon, panelLabel, type TerminalPanel } from './panelTypes';
import type { GitFileStatus, RunnerScript } from '../../types';
import { openInEntry, moveToEntry, githubEntries, type TaskMenuActions } from '../kanban/taskMenu';
import { revealInFileManager } from '../../utils/fileManager';
import { useExperimentalStore } from '../../stores/experimentalStore';
import { openPullRequestInPanel, createPullRequestForTask, unlinkPullRequest } from '../../services/githubTaskActions';
import { BranchFromTaskDialog } from '../dialogs/BranchFromTaskDialog';
import { effectiveDiffMode, filesInDiff } from '../../diffSource';

interface TerminalHeaderProps {
  ptyId: string;
  isActive: boolean;
  isBackCard?: boolean;
  compact?: boolean;
  stackPosition?: number;
  onClose: () => void;
}

export const TerminalHeader = memo(function TerminalHeader({
  ptyId,
  isActive,
  isBackCard,
  compact,
  stackPosition,
  onClose,
}: TerminalHeaderProps) {
  // One shallow-compared subscription replaces many individual selectors.
  const {
    label,
    summaryType,
    gitFileStatus,
    lastOscTitle,
    tags,
    sandboxProvider,
    taskId,
    worktreeBranch,
    diffPanelOpen,
    panels,
    activePanelId,
  } = useTerminalStore(
    useShallow((s) => {
      const d = s.displayStates[ptyId];
      return {
        label: d?.label ?? '',
        summaryType: d?.summaryType ?? 'ready',
        gitFileStatus: d?.gitFileStatus ?? null,
        lastOscTitle: d?.lastOscTitle ?? '',
        tags: d?.tags ?? EMPTY_TAGS,
        sandboxProvider: d?.sandboxProvider,
        taskId: d?.taskId ?? null,
        worktreeBranch: d?.worktreeBranch ?? null,
        diffPanelOpen: d?.diffPanelOpen ?? false,
        panels: d?.panels ?? EMPTY_PANELS,
        activePanelId: d?.activePanelId ?? null,
      };
    }),
  );

  const panelOps = useTerminalPanels(ptyId);

  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editorHookDialog, setEditorHookDialog] = useState(false);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<null | 'terminal' | 'task'>(null);
  const [branchFromDialog, setBranchFromDialog] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const instance = terminalInstances.get(ptyId);
  const projectPath = instance?.projectPath ?? '';
  const isTaskTerminal = taskId != null;

  const availableSandboxProviders = useProjectStore((s) => s.availableSandboxProviders);
  const hasEditorHook = useProjectStore((s) => !!s.configuredHooks.editor);
  const task = useProjectStore((s) => (taskId != null ? s.tasks.find((t) => t.taskNumber === taskId) : undefined));
  const githubEnabled = useExperimentalStore((s) => s.flagsByProject[projectPath]?.github ?? false);

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!instance) return [];
    const items: ContextMenuEntry[] = [];

    // A task terminal shares the task's context menu (Open in / Move to /
    // Branch), so it stays identical to the kanban card. It adds terminal-scoped
    // items — Rename terminal, Close Task — that the card has no notion of.
    if (isTaskTerminal) {
      const hasWorktree = !!instance.worktreePath && !!instance.worktreeBranch;
      const actions: TaskMenuActions = {
        openTerminal: (provider) => {
          addProjectTerminal(projectPath, undefined, {
            existingWorktree: { path: instance.worktreePath!, branch: instance.worktreeBranch!, createdAt: '' },
            taskId: taskId!,
            sandboxProvider: provider,
          });
        },
        openEditor: () => {
          if (hasEditorHook && instance.worktreePath) {
            openWorktreeEditor(
              projectPath,
              { path: instance.worktreePath, branch: instance.worktreeBranch ?? '', createdAt: '' },
              taskId ?? undefined,
            );
          } else {
            setEditorHookDialog(true);
          }
        },
        openFolder: () => void revealInFileManager(instance.worktreePath!),
        setStatus: async (status) => {
          await window.api.task.setStatus(projectPath, taskId!, status);
          useProjectStore.getState().loadTasks(projectPath);
        },
        completeToDone: task ? () => void completeTask({ projectPath, task }) : undefined,
        trash: async () => {
          await window.api.task.trash(projectPath, taskId!);
          useProjectStore.getState().loadTasks(projectPath);
          useProjectStore.getState().addToast('Task moved to trash', 'success');
        },
      };

      items.push(openInEntry(availableSandboxProviders, hasWorktree, actions));
      items.push({ separator: true });
      items.push(moveToEntry(actions));
      if (task?.branch && task.status !== 'done') {
        items.push({ label: 'Branch from this task', icon: 'git-branch', onClick: () => setBranchFromDialog(true) });
      }
      items.push({ label: 'Rename task', icon: 'pencil-simple', onClick: () => setRenameTarget('task') });

      // The same entries the kanban card shows.
      const github = task
        ? githubEntries(
            { enabled: githubEnabled, prNumber: task.githubPrNumber, hasBranch: !!task.branch },
            {
              openPullRequest: (prNumber) => openPullRequestInPanel(projectPath, prNumber),
              createPullRequest: () => void createPullRequestForTask(projectPath, task),
              unlinkPullRequest: () => void unlinkPullRequest(projectPath, task.taskNumber),
            },
          )
        : [];
      if (github.length > 0) {
        items.push({ separator: true }, ...github);
      }
    }

    items.push({
      label: isTaskTerminal ? 'Rename terminal' : 'Rename',
      icon: 'pencil-simple',
      onClick: () => setRenameTarget('terminal'),
    });

    return items;
  }, [isTaskTerminal, instance, projectPath, taskId, availableSandboxProviders, hasEditorHook, task, githubEnabled]);

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
      if (renameTarget === 'task' && taskId != null) {
        void window.api.task.setName(projectPath, taskId, value).then(() => {
          useProjectStore.getState().loadTasks(projectPath);
        });
      } else {
        renameTerminal(ptyId, value);
      }
    }
    setRenameTarget(null);
  }, [ptyId, renameTarget, taskId, projectPath]);

  useEffect(() => {
    if (renameTarget && renameInputRef.current) {
      renameInputRef.current.value = renameTarget === 'task' ? (task?.name ?? '') : label;
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameTarget, label, task]);

  const handleTagButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTagInputOpen((prev) => !prev);
  }, []);

  const handleDiffClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const inst = terminalInstances.get(ptyId);
      if (!inst) return;
      inst.toggleDiffPanel();
      if (inst.diffPanelOpen) useProjectStore.getState().setKanbanVisible(false);
    },
    [ptyId],
  );

  const openAddMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = addRef.current?.getBoundingClientRect();
    if (rect) setAddMenu({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const handleAddRunner = useCallback(
    (script?: RunnerScript) => {
      void startRunner(ptyId, script);
    },
    [ptyId],
  );
  const handleAddWebPreview = useCallback(() => {
    terminalInstances.get(ptyId)?.addWebPreviewPanel(null);
  }, [ptyId]);
  const handleAddPlan = useCallback(
    (planPath: string) => {
      terminalInstances.get(ptyId)?.addPlanPanel(planPath);
    },
    [ptyId],
  );

  const isWorktree = taskId != null && !!worktreeBranch;

  const nameContent = renameTarget ? (
    <input
      ref={renameInputRef}
      className="font-mono text-xs font-medium text-ink/85 bg-transparent border-0 border-b border-accent p-0 outline-none min-w-0 shrink-0 [-webkit-app-region:no-drag]"
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitRename();
        if (e.key === 'Escape') setRenameTarget(null);
      }}
    />
  ) : (
    <TerminalHeaderName label={label} lastOscTitle={lastOscTitle} />
  );

  const tagsContent =
    isActive && tagInputOpen ? (
      <TagInput ptyId={ptyId} onClose={() => setTagInputOpen(false)} />
    ) : isActive ? (
      <>
        {tags.map((tag) => (
          <button
            key={tag}
            className={`nodrag ${METADATA_CHIP} border-none hover:bg-ink/[0.1] hover:text-ink/75 transition-colors duration-150`}
            onMouseDown={handleTagButtonClick}
          >
            {tag}
          </button>
        ))}
        {tags.length === 0 && (
          <button
            className="nodrag inline-flex items-center gap-1 font-mono text-[11px] text-ink/35 bg-transparent border-none px-2 py-0.5 rounded-full shrink-0 opacity-0 group-hover/meta:opacity-100 hover:text-ink/70 hover:bg-ink/[0.05] transition-all duration-150"
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
    );

  const overlays = (
    <>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {addMenu && (
        <AddPanelMenu
          ptyId={ptyId}
          projectPath={projectPath}
          x={addMenu.x}
          y={addMenu.y}
          onAddRunner={handleAddRunner}
          onAddWebPreview={handleAddWebPreview}
          onAddPlan={handleAddPlan}
          onClose={() => setAddMenu(null)}
        />
      )}
      {branchFromDialog && task && (
        <BranchFromTaskDialog projectPath={projectPath} parentTask={task} onClose={() => setBranchFromDialog(false)} />
      )}
      {editorHookDialog && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType="editor"
          onClose={(result) => {
            setEditorHookDialog(false);
            if (result?.saved) {
              useProjectStore.getState().markHookConfigured('editor');
              // Open the editor straight away rather than making the user
              // re-invoke "Open in Editor" after configuring it.
              if (result.hook?.command && instance?.worktreePath) {
                openWorktreeEditor(
                  projectPath,
                  { path: instance.worktreePath, branch: instance.worktreeBranch ?? '', createdAt: '' },
                  taskId ?? undefined,
                );
              }
            }
          }}
        />
      )}
    </>
  );

  return (
    <TerminalHeaderView
      summaryType={summaryType}
      sandboxProvider={sandboxProvider}
      stackPosition={stackPosition}
      isActive={isActive}
      isBackCard={isBackCard}
      compact={compact}
      nameContent={nameContent}
      tagsContent={tagsContent}
      branchContent={gitFileStatus?.branch ? <BranchCopy branch={gitFileStatus.branch} /> : undefined}
      actions={
        isActive && !compact ? (
          <PanelControls
            panels={panels}
            activePanelId={activePanelId}
            gitFileStatus={gitFileStatus}
            isWorktree={isWorktree}
            diffPanelOpen={diffPanelOpen}
            addRef={addRef}
            onActivate={panelOps.activatePanel}
            onMinimize={panelOps.minimizePanel}
            onClosePanel={panelOps.closePanel}
            onDiffClick={handleDiffClick}
            onAddClick={openAddMenu}
          />
        ) : undefined
      }
      showCloseButton
      onClose={handleCloseClick}
      onContextMenu={handleContextMenu}
      overlays={overlays}
    />
  );
});

// ── Sub-components ───────────────────────────────────────────────────

const METADATA_CHIP =
  'inline-flex items-center gap-1 font-mono text-[11px] font-medium text-ink/55 bg-ink/[0.05] rounded-full px-2 py-0.5 shrink-0';

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
      className="inline-flex items-center gap-1 font-mono text-[11px] text-ink/45 bg-transparent border-none p-0 min-w-0 self-start shrink-0 transition-colors duration-150 hover:text-ink/75"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon name={iconName} className="w-3 h-3 shrink-0 text-ink/35" />
      <span className="truncate">{copied ? 'Copied' : branch}</span>
    </button>
  );
}

// Joined, beveled segmented control in the terminal header: one segment per
// open panel (runner/preview/plan) plus the contextual diff toggle, an "add"
// trigger, and a full-width toggle when a panel is active.
const groupButtonBase =
  'group/seg h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium transition-colors duration-150 ease-out';
// Panel tabs behave like browser tabs: `flex-1` (zero basis, equal grow) hands
// every tab the same share of the control, `max-w-max` caps each at its own
// natural width so a lone tab isn't stretched, and `min-w-0` lets them all
// truncate together once the header runs out of room.
const groupButtonFlexible = 'flex-1 min-w-0 max-w-max overflow-hidden';
const groupButtonInactive = 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary';
const groupButtonActive = 'bg-accent text-accent-ink hover:bg-accent';

const RUNNER_DOT: Record<string, string> = {
  running: 'bg-status-ready',
  success: 'bg-status-ready',
  error: 'bg-ansi-red',
  idle: 'bg-ink/30',
};

function PanelControls({
  panels,
  activePanelId,
  gitFileStatus,
  isWorktree,
  diffPanelOpen,
  addRef,
  onActivate,
  onMinimize,
  onClosePanel,
  onDiffClick,
  onAddClick,
}: {
  panels: TerminalPanel[];
  activePanelId: string | null;
  gitFileStatus: GitFileStatus | null;
  isWorktree: boolean;
  diffPanelOpen: boolean;
  addRef: React.RefObject<HTMLButtonElement | null>;
  onActivate: (id: string) => void;
  onMinimize: () => void;
  onClosePanel: (id: string) => void;
  onDiffClick: (e: React.MouseEvent) => void;
  onAddClick: (e: React.MouseEvent) => void;
}) {
  // The same rule the panel this button opens follows, and then the same file
  // list, so the two never offer and show different diffs. Counting from
  // `uncommittedFiles` alone would leave untracked files out of the button and
  // in the panel — and hide the button entirely for a branch whose only changes
  // are new files.
  const mode = gitFileStatus ? effectiveDiffMode(gitFileStatus, 'worktree') : null;
  const diffFiles = gitFileStatus && mode ? filesInDiff(gitFileStatus, mode) : [];
  const dirtyFileCount = diffFiles.length;
  const insertions = diffFiles.reduce((s, f) => s + f.additions, 0);
  const deletions = diffFiles.reduce((s, f) => s + f.deletions, 0);
  const hasUncommitted = mode === 'uncommitted';
  const showCompare = mode === 'worktree' && isWorktree && dirtyFileCount > 0;
  const showDiff = hasUncommitted || showCompare;

  const slots: React.ReactNode[] = [];

  for (const panel of panels) {
    const active = panel.id === activePanelId;
    slots.push(
      <button
        key={panel.id}
        className={`${groupButtonBase} ${groupButtonFlexible} ${active ? groupButtonActive : groupButtonInactive}`}
        // Clicking the already-active tab minimizes it (collapses to the bare terminal).
        onClick={() => (active ? onMinimize() : onActivate(panel.id))}
      >
        {panel.kind === 'runner' ? (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RUNNER_DOT[panel.status] ?? 'bg-ink/30'}`} />
        ) : (
          <Icon name={panelIcon(panel)} className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="truncate max-w-[120px]">{panelLabel(panel)}</span>
        <span
          role="button"
          aria-label="Close panel"
          onClick={(e) => {
            e.stopPropagation();
            onClosePanel(panel.id);
          }}
          // The huge shrink factor collapses the close affordance before the
          // label gives up any width, so a squeezed tab keeps its name.
          className="-mr-1 ml-0.5 w-4 h-4 flex items-center justify-center rounded shrink-[9999] min-w-0 overflow-hidden opacity-0 group-hover/seg:opacity-100 hover:bg-ink/15 transition-all duration-150 [&>svg]:w-3 [&>svg]:h-3"
        >
          <Icon name="x" />
        </span>
      </button>,
    );
  }

  if (showDiff) {
    slots.push(
      <button
        key="diff"
        className={`${groupButtonBase} shrink-0 ${diffPanelOpen ? groupButtonActive : groupButtonInactive}`}
        onClick={onDiffClick}
      >
        {hasUncommitted ? (
          <>
            <span>
              {dirtyFileCount} {dirtyFileCount === 1 ? 'file' : 'files'}
            </span>
            {insertions > 0 && <span className={diffPanelOpen ? '' : 'text-status-ready'}>+{insertions}</span>}
            {deletions > 0 && <span className={diffPanelOpen ? '' : 'text-ansi-red'}>-{deletions}</span>}
          </>
        ) : (
          <span>Compare</span>
        )}
      </button>,
    );
  }

  slots.push(
    <button
      key="add"
      ref={addRef}
      className={`${groupButtonBase} shrink-0 !px-2 ${groupButtonInactive}`}
      onClick={onAddClick}
      aria-label="Add panel"
    >
      <Icon name="plus" className="w-3.5 h-3.5" />
    </button>,
  );

  return (
    <div className="flex items-center min-w-0 h-7 bg-background-secondary glass-bevel relative border border-bezel rounded-[12px] overflow-hidden">
      {slots.map((slot, i) => (
        <Fragment key={i}>
          {i > 0 && <div aria-hidden className="w-px h-3 shrink-0 bg-ink/10 self-center" />}
          {slot}
        </Fragment>
      ))}
    </div>
  );
}
