import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { getProjectConfig, loadTasks, useProjectConfig, useProjectTask } from '../../stores/projectDataStore';
import { tasksOpenAsChat } from '../../services/chatSettings';
import { useShallow } from 'zustand/react/shallow';
import { terminalInstances } from './terminalRegistry';
import { addProjectTerminal, renameTerminal } from './terminalActions';
import { completeTask } from '../../services/taskCompletion';
import { Icon } from './Icon';
import { TagInput } from './TagInput';
import { TerminalHeaderView, TerminalHeaderName } from './TerminalHeaderView';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { Tooltip } from '../ui/Tooltip';
import type { GitFileStatus, SandboxBackendId } from '../../types';
import { closedTaskChats, openEntries, moveToEntry, trackerEntries, type TaskMenuActions } from '../kanban/taskMenu';
import { revealInFileManager } from '../../utils/fileManager';
import { useExperimentalStore } from '../../stores/experimentalStore';
import { openTaskInEditor, openWorktreeInEditor } from '../../services/openInEditor';
import { openTaskChat, openTaskSession, openTaskTerminal } from '../navigation';
import { BranchFromTaskDialog } from '../dialogs/BranchFromTaskDialog';
import { describeDiffComparison, filesInDiff } from '../../diffSource';
import { useWantsYou } from './wantsYou';
import { useChatStore } from '../../stores/chatStore';
import { addChatCard } from '../chat/chatActions';

const EMPTY_TAGS: string[] = [];
const NO_BACKENDS: SandboxBackendId[] = [];

interface TerminalHeaderProps {
  ptyId: string;
  isActive: boolean;
  isBackCard?: boolean;
  stackPosition?: number;
  onClose: () => void;
}

export const TerminalHeader = memo(function TerminalHeader({
  ptyId,
  isActive,
  isBackCard,
  stackPosition,
  onClose,
}: TerminalHeaderProps) {
  // One shallow-compared subscription replaces many individual selectors.
  const { label, status, gitFileStatus, lastOscTitle, tags, sandboxProvider, taskId, diffPanelOpen, surface } =
    useTerminalStore(
      useShallow((s) => {
        const d = s.displayStates[ptyId];
        return {
          label: d?.label ?? '',
          status: d?.status ?? 'ready',
          gitFileStatus: d?.gitFileStatus ?? null,
          lastOscTitle: d?.lastOscTitle ?? '',
          tags: d?.tags ?? EMPTY_TAGS,
          sandboxProvider: d?.sandboxProvider,
          taskId: d?.taskId ?? null,
          diffPanelOpen: d?.diffPanelOpen ?? false,
          surface: d?.surface ?? 'terminal',
        };
      }),
    );
  const chatCapabilities = useChatStore((s) => s.sessions[ptyId]?.info.capabilities);

  const unread = useWantsYou(ptyId);

  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<null | 'terminal' | 'task'>(null);
  const [branchFromDialog, setBranchFromDialog] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const instance = terminalInstances.get(ptyId);
  const projectPath = instance?.projectPath ?? '';
  const isTaskTerminal = taskId != null;

  const availableSandboxProviders = useProjectConfig(projectPath)?.availableSandboxProviders ?? NO_BACKENDS;
  const task = useProjectTask(projectPath, taskId);
  const githubEnabled = useExperimentalStore((s) => s.flagsByProject[projectPath]?.github ?? false);
  const linearEnabled = useExperimentalStore((s) => s.flagsByProject[projectPath]?.linear ?? false);
  const taskChats = useChatStore((s) => s.taskChats[projectPath]);

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!instance) return [];
    const items: ContextMenuEntry[] = [];

    // A task terminal shares the task's context menu (Resume / Move to /
    // Branch), so it stays identical to the kanban card. It adds terminal-scoped
    // items — Rename terminal, Close Task — that the card has no notion of.
    if (isTaskTerminal) {
      const hasWorktree = !!instance.worktreePath && !!instance.worktreeBranch;
      const actions: TaskMenuActions = {
        openTerminal: (provider) => {
          if (task) {
            void openTaskTerminal(projectPath, task, provider);
            return;
          }
          addProjectTerminal(projectPath, undefined, {
            existingWorktree: { path: instance.worktreePath!, branch: instance.worktreeBranch!, createdAt: '' },
            taskId: taskId!,
            sandboxProvider: provider,
          });
        },
        openSession: task ? (surface, place) => void openTaskSession(projectPath, task, surface, place) : undefined,
        earlierChats: task
          ? {
              chats: closedTaskChats(taskChats, task.taskNumber),
              open: (chat) => void openTaskChat(projectPath, task, chat),
            }
          : undefined,
        openEditor: () => {
          if (instance.worktreePath) {
            void openWorktreeInEditor(
              projectPath,
              { path: instance.worktreePath, branch: instance.worktreeBranch ?? '', createdAt: '' },
              taskId ?? undefined,
            );
          } else if (task) {
            void openTaskInEditor(projectPath, task);
          }
        },
        openFolder: () => void revealInFileManager(instance.worktreePath!),
        setStatus: async (status) => {
          await window.api.task.setStatus(projectPath, taskId!, status);
          loadTasks(projectPath);
        },
        completeToDone: task ? () => void completeTask({ projectPath, task }) : undefined,
        trash: async () => {
          await window.api.task.trash(projectPath, taskId!);
          loadTasks(projectPath);
          useProjectStore.getState().addToast('Task moved to trash', 'success');
        },
      };

      items.push(
        ...openEntries(
          availableSandboxProviders,
          hasWorktree,
          actions,
          getProjectConfig(projectPath)?.defaultSandbox ?? 'none',
          task?.status !== 'todo',
          tasksOpenAsChat(projectPath),
        ),
      );
      items.push({ separator: true });
      items.push(moveToEntry(actions));
      if (task?.branch && task.status !== 'done') {
        items.push({ label: 'Branch from this task', icon: 'git-branch', onClick: () => setBranchFromDialog(true) });
      }
      items.push({ label: 'Rename task', icon: 'pencil-simple', onClick: () => setRenameTarget('task') });

      items.push(...trackerEntries(projectPath, task, { github: githubEnabled, linear: linearEnabled }));
    }

    items.push({
      label: isTaskTerminal ? 'Rename terminal' : 'Rename',
      icon: 'pencil-simple',
      onClick: () => setRenameTarget('terminal'),
    });

    if (surface === 'chat' && chatCapabilities) {
      items.push({ separator: true });
      if (chatCapabilities.fork) {
        items.push({
          label: 'Fork conversation',
          icon: 'git-fork',
          onClick: () => void forkChat(ptyId),
        });
      }
      if (chatCapabilities.compact) {
        items.push({
          label: 'Compact conversation',
          icon: 'arrows-in',
          onClick: () => void window.api.chat.compact(ptyId),
        });
      }
    }

    return items;
  }, [
    isTaskTerminal,
    instance,
    projectPath,
    taskId,
    availableSandboxProviders,
    task,
    githubEnabled,
    linearEnabled,
    surface,
    chatCapabilities,
    ptyId,
    taskChats,
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
      if (renameTarget === 'task' && taskId != null) {
        void window.api.task.setName(projectPath, taskId, value).then(() => {
          loadTasks(projectPath);
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
    },
    [ptyId],
  );

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
      {branchFromDialog && task && (
        <BranchFromTaskDialog projectPath={projectPath} parentTask={task} onClose={() => setBranchFromDialog(false)} />
      )}
    </>
  );

  return (
    <TerminalHeaderView
      status={status}
      sandboxProvider={sandboxProvider}
      unread={unread}
      stackPosition={stackPosition}
      isActive={isActive}
      isBackCard={isBackCard}
      nameContent={nameContent}
      tagsContent={tagsContent}
      branchContent={gitFileStatus?.branch ? <BranchCopy branch={gitFileStatus.branch} /> : undefined}
      actions={
        isActive ? (
          <>
            <DiffButton gitFileStatus={gitFileStatus} diffPanelOpen={diffPanelOpen} onClick={handleDiffClick} />
          </>
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

async function forkChat(ptyId: string): Promise<void> {
  const term = terminalInstances.get(ptyId);
  if (!term) return;
  try {
    const forked = await window.api.chat.fork(ptyId);
    useChatStore.getState().adopt(forked);
    await addChatCard(term.projectPath, {
      id: forked.info.id,
      agent: forked.info.agent,
      taskId: term.taskId ?? undefined,
      worktree: term.worktreePath ? { path: term.worktreePath, branch: term.worktreeBranch ?? '' } : undefined,
      sandboxProvider: term.sandboxProvider,
      label: `${term.label} (fork)`,
    });
  } catch (error) {
    useProjectStore.getState().addToast(error instanceof Error ? error.message : String(error), 'error');
  }
}

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
      className="inline-flex items-center gap-1 font-mono text-[11px] text-ink/45 bg-transparent border-none p-0 min-w-0 max-w-full self-start shrink-0 transition-colors duration-150 hover:text-ink/75"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon name={iconName} className="w-3 h-3 shrink-0 text-ink/35" />
      <span className="truncate">{copied ? 'Copied' : branch}</span>
    </button>
  );
}

/**
 * The size of the change, and nothing about what it is measured against: the
 * tooltip says that, and on a board of task cards the base is the same one on
 * nearly every card. Offered wherever there is a repo to read, not only where
 * the comparison has something in it, since the panel it opens is where
 * another one is chosen.
 */
function DiffButton({
  gitFileStatus,
  diffPanelOpen,
  onClick,
}: {
  gitFileStatus: GitFileStatus | null;
  diffPanelOpen: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  if (!gitFileStatus) return null;
  const files = filesInDiff(gitFileStatus);
  const insertions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <Tooltip
      text={describeDiffComparison(gitFileStatus.base, gitFileStatus.branch)}
      referenceClassName="shrink-0 inline-flex"
    >
      <button
        type="button"
        aria-label="Diff"
        aria-pressed={diffPanelOpen}
        onClick={onClick}
        className={`h-7 px-2 flex items-center gap-1.5 rounded-md border-none text-[13px] transition-colors duration-150 ${
          diffPanelOpen
            ? 'bg-ink/[0.07] text-ink/85'
            : 'bg-transparent text-ink/55 hover:text-ink/85 hover:bg-ink/[0.05]'
        }`}
      >
        <Icon name="git-diff" className="w-3.5 h-3.5 shrink-0" />
        {files.length > 0 && (
          <>
            <span className="shrink-0">
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </span>
            {insertions > 0 && <span className="text-status-ready">+{insertions}</span>}
            {deletions > 0 && <span className="text-ansi-red">-{deletions}</span>}
          </>
        )}
      </button>
    </Tooltip>
  );
}
