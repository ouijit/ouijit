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
    sandboxed,
    taskId,
    worktreeBranch,
    diffPanelOpen,
    panels,
    activePanelId,
    panelFullWidth,
  } = useTerminalStore(
    useShallow((s) => {
      const d = s.displayStates[ptyId];
      return {
        label: d?.label ?? '',
        summaryType: d?.summaryType ?? 'ready',
        gitFileStatus: d?.gitFileStatus ?? null,
        lastOscTitle: d?.lastOscTitle ?? '',
        tags: d?.tags ?? EMPTY_TAGS,
        sandboxed: d?.sandboxed ?? false,
        taskId: d?.taskId ?? null,
        worktreeBranch: d?.worktreeBranch ?? null,
        diffPanelOpen: d?.diffPanelOpen ?? false,
        panels: d?.panels ?? EMPTY_PANELS,
        activePanelId: d?.activePanelId ?? null,
        panelFullWidth: d?.panelFullWidth ?? true,
      };
    }),
  );

  const panelOps = useTerminalPanels(ptyId);

  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editorHookDialog, setEditorHookDialog] = useState(false);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const instance = terminalInstances.get(ptyId);
  const projectPath = instance?.projectPath ?? '';
  const isTaskTerminal = taskId != null;

  const sandboxAvailable = useProjectStore((s) => s.sandboxAvailable);
  const hasEditorHook = useProjectStore((s) => !!s.configuredHooks.editor);

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
            openWorktreeEditor(
              projectPath,
              { path: instance.worktreePath, branch: instance.worktreeBranch ?? '', createdAt: '' },
              taskId ?? undefined,
            );
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
          const storeTask = useProjectStore.getState().tasks.find((t) => t.taskNumber === taskId);
          if (!storeTask) return;
          await completeTask({ projectPath, task: storeTask });
          useProjectStore.getState().addToast('Task closed', 'success');
        },
      });
    }

    return items;
  }, [isTaskTerminal, instance, projectPath, taskId, sandboxAvailable, hasEditorHook]);

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
    if (value) renameTerminal(ptyId, value);
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

  const nameContent = renaming ? (
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
      sandboxed={sandboxed}
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
            panelFullWidth={panelFullWidth}
            gitFileStatus={gitFileStatus}
            isWorktree={isWorktree}
            diffPanelOpen={diffPanelOpen}
            addRef={addRef}
            onActivate={panelOps.activatePanel}
            onClosePanel={panelOps.closePanel}
            onSetFullWidth={panelOps.setPanelFullWidth}
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

// Joined, beveled segmented control in the terminal header: one segment per
// open panel (runner/preview/plan) plus the contextual diff toggle, an "add"
// trigger, and a full-width toggle when a panel is active.
const groupButtonBase =
  'group/seg h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium transition-colors duration-150 ease-out';
const groupButtonInactive = 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary';
const groupButtonActive = 'bg-accent text-white hover:bg-accent';

const RUNNER_DOT: Record<string, string> = {
  running: 'bg-[#4ee82e]',
  success: 'bg-[#4ee82e]',
  error: 'bg-[#ff6b6b]',
  idle: 'bg-white/30',
};

function PanelControls({
  panels,
  activePanelId,
  panelFullWidth,
  gitFileStatus,
  isWorktree,
  diffPanelOpen,
  addRef,
  onActivate,
  onClosePanel,
  onSetFullWidth,
  onDiffClick,
  onAddClick,
}: {
  panels: TerminalPanel[];
  activePanelId: string | null;
  panelFullWidth: boolean;
  gitFileStatus: GitFileStatus | null;
  isWorktree: boolean;
  diffPanelOpen: boolean;
  addRef: React.RefObject<HTMLButtonElement | null>;
  onActivate: (id: string) => void;
  onClosePanel: (id: string) => void;
  onSetFullWidth: (fullWidth: boolean) => void;
  onDiffClick: (e: React.MouseEvent) => void;
  onAddClick: (e: React.MouseEvent) => void;
}) {
  const dirtyFileCount = gitFileStatus?.uncommittedFiles.length ?? 0;
  const insertions = gitFileStatus?.uncommittedFiles.reduce((s, f) => s + f.additions, 0) ?? 0;
  const deletions = gitFileStatus?.uncommittedFiles.reduce((s, f) => s + f.deletions, 0) ?? 0;
  const branchDiffCount = gitFileStatus?.branchDiffFiles.length ?? 0;
  const hasUncommitted = !!gitFileStatus && dirtyFileCount > 0;
  const showCompare = !!gitFileStatus && !hasUncommitted && isWorktree && branchDiffCount > 0;
  const showDiff = hasUncommitted || showCompare;
  const hasActive = activePanelId != null && panels.some((p) => p.id === activePanelId);

  const slots: React.ReactNode[] = [];

  for (const panel of panels) {
    const active = panel.id === activePanelId;
    slots.push(
      <button
        key={panel.id}
        className={`${groupButtonBase} ${active ? groupButtonActive : groupButtonInactive}`}
        onClick={() => onActivate(panel.id)}
      >
        {panel.kind === 'runner' ? (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RUNNER_DOT[panel.status] ?? 'bg-white/30'}`} />
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
          className="-mr-1 ml-0.5 w-4 h-4 flex items-center justify-center rounded shrink-0 opacity-0 group-hover/seg:opacity-100 hover:bg-white/15 transition-all duration-150 [&>svg]:w-3 [&>svg]:h-3"
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
        className={`${groupButtonBase} ${diffPanelOpen ? groupButtonActive : groupButtonInactive}`}
        onClick={onDiffClick}
      >
        {hasUncommitted ? (
          <>
            <span>
              {dirtyFileCount} {dirtyFileCount === 1 ? 'file' : 'files'}
            </span>
            {insertions > 0 && <span className={diffPanelOpen ? '' : 'text-[#4ee82e]'}>+{insertions}</span>}
            {deletions > 0 && <span className={diffPanelOpen ? '' : 'text-[#ff6b6b]'}>-{deletions}</span>}
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
      className={`${groupButtonBase} !px-2 ${groupButtonInactive}`}
      onClick={onAddClick}
      aria-label="Add panel"
    >
      <Icon name="plus" className="w-3.5 h-3.5" />
    </button>,
  );

  if (hasActive) {
    slots.push(
      <button
        key="fullwidth"
        className={`${groupButtonBase} !px-2 ${groupButtonInactive}`}
        onClick={() => onSetFullWidth(!panelFullWidth)}
        aria-label={panelFullWidth ? 'Split view' : 'Full width'}
      >
        <Icon
          name={panelFullWidth ? 'square-split-horizontal' : 'arrows-out-line-horizontal'}
          className="w-3.5 h-3.5"
        />
      </button>,
    );
  }

  return (
    <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
      {slots.map((slot, i) => (
        <Fragment key={i}>
          {i > 0 && <div aria-hidden className="w-px h-3 bg-white/10 self-center" />}
          {slot}
        </Fragment>
      ))}
    </div>
  );
}
