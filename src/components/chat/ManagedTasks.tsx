import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '../terminal/Icon';
import { useAsking, wantsYou } from '../terminal/wantsYou';
import { GroupMark, SidebarRow, mostUrgent, useProjectName, type GroupState } from '../sidebar/SidebarRows';
import { StageIcon } from '../sidebar/StageIcon';
import { focusTerminal, openTaskTerminal } from '../navigation';
import { useAppStore } from '../../stores/appStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { BackgroundDots } from './ChatBackground';
import { loadTasks } from '../../stores/projectDataStore';
import type { TaskRef } from '../../chat/preferences';
import type { TaskWithWorkspace } from '../../types';

const NONE: TaskRef[] = [];

interface Managed {
  projectPath: string;
  task: TaskWithWorkspace;
}

/** The task's terminals and chats, most recently used first, as its sidebar row orders them. */
function taskSessions(s: ReturnType<typeof useTerminalStore.getState>, { projectPath, task }: Managed): string[] {
  return s.order.filter(
    (id) => s.displayStates[id]?.projectPath === projectPath && s.displayStates[id]?.taskId === task.taskNumber,
  );
}

/** A task's state as its sidebar row shows it: what most needs the user across its sessions; null with none open. */
function taskState(
  s: ReturnType<typeof useTerminalStore.getState>,
  managed: Managed,
  asking: string[],
): GroupState | null {
  const ids = taskSessions(s, managed);
  if (ids.length === 0) return null;
  return mostUrgent(
    ids.map((id): GroupState =>
      wantsYou(s, id, asking) ? 'unread' : s.displayStates[id]?.status === 'thinking' ? 'thinking' : 'ready',
    ),
  );
}

/**
 * Work its chats left running after their turns, and whether a turn is still
 * going in any of its sessions. Only then is the row's mark the thinking one;
 * background work alone moves where the mark is instead.
 */
function useBackground(managed: Managed): { count: number; turn: boolean } {
  const ids = useTerminalStore(useShallow((s) => taskSessions(s, managed)));
  const thinking = useTerminalStore(useShallow((s) => ids.map((id) => s.displayStates[id]?.status === 'thinking')));
  return useChatStore(
    useShallow((s) => {
      let count = 0;
      let turn = false;
      ids.forEach((id, i) => {
        const info = s.sessions[id]?.info;
        count += info?.background?.length ?? 0;
        if (info ? info.status === 'running' : thinking[i]) turn = true;
      });
      return { count, turn };
    }),
  );
}

function ManagedRow({ managed, state }: { managed: Managed; state: GroupState | null }) {
  const { projectPath, task } = managed;
  const projectName = useProjectName(projectPath);
  const background = useBackground(managed);
  const backgroundOnly = background.count > 0 && !background.turn && state === 'thinking';
  const open = () => {
    const [front] = taskSessions(useTerminalStore.getState(), managed);
    if (front) void focusTerminal(front, { projectPath });
    else void openTaskTerminal(projectPath, task);
  };
  return (
    <SidebarRow
      icon={<StageIcon status={task.status} />}
      title={task.name || `T-${task.taskNumber}`}
      tooltip={`${task.name} · ${projectName}`}
      bright={false}
      faint={!state}
      unread={state === 'unread'}
      detail={
        background.count > 0 ? (
          <span className="flex items-center gap-1">
            {background.turn && (
              <span className="flex scale-75 -mr-0.5">
                <BackgroundDots />
              </span>
            )}
            {background.count} in background · {projectName}
          </span>
        ) : (
          projectName
        )
      }
      trailing={
        backgroundOnly ? (
          <span
            className="w-3.5 flex items-center justify-center shrink-0"
            data-testid="group-mark"
            data-state="background"
          >
            <BackgroundDots />
          </span>
        ) : (
          state && <GroupMark state={state} />
        )
      }
      onClick={open}
    />
  );
}

/**
 * The tasks a conversation of Chat's follows, as the sidebar shows them: each
 * one's column and state, and a click away from its card. A task leaves once it
 * is done or no longer followed. More than one folds behind a count whose one
 * mark is what most needs the user.
 */
export function ManagedTasks({ conversation }: { conversation: string }) {
  const [open, setOpen] = useState(false);
  const refs = useHomeChatStore((s) => s.following[conversation] ?? NONE);
  const found = useAppStore(
    useShallow((s) =>
      refs.map((ref) => s.taskCacheByProject[ref.projectPath]?.find((t) => t.taskNumber === ref.taskNumber) ?? null),
    ),
  );
  const tasks = useMemo(
    () =>
      refs.flatMap((ref, i): Managed[] => {
        const task = found[i];
        return task && task.status !== 'done' ? [{ projectPath: ref.projectPath, task }] : [];
      }),
    [refs, found],
  );
  const unloaded = useAppStore(
    useShallow((s) => [...new Set(refs.map((ref) => ref.projectPath))].filter((path) => !s.taskCacheByProject[path])),
  );
  useEffect(() => {
    for (const path of unloaded) void loadTasks(path);
  }, [unloaded]);
  const asking = useAsking();
  const states = useTerminalStore(useShallow((s) => tasks.map((managed) => taskState(s, managed, asking))));

  if (tasks.length === 0) return null;
  const rows = tasks.map((managed, i) => (
    <ManagedRow key={`${managed.projectPath}#${managed.task.taskNumber}`} managed={managed} state={states[i]} />
  ));
  if (tasks.length === 1) {
    return (
      <div aria-label="Tasks Chat is managing" className="mx-4 mb-1.5 p-1 rounded-[11px] bg-ink/[0.04]">
        {rows}
      </div>
    );
  }
  return (
    <div aria-label="Tasks Chat is managing" className="mx-4 mb-1.5 p-1 rounded-[11px] bg-ink/[0.04]">
      <button
        type="button"
        aria-expanded={open}
        className="w-full h-7 flex items-center gap-2 pl-2 pr-2.5 rounded-[7px] text-[13px] text-left hover:bg-ink/5 transition-colors duration-100"
        style={{ color: 'color-mix(in srgb, var(--color-text-primary) 62%, transparent)' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-3.5 flex items-center justify-center shrink-0">
          <Icon
            name="caret-down"
            className={`w-3 h-3 text-text-tertiary transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
          />
        </span>
        <span className="flex-1 min-w-0 truncate">{tasks.length} tasks</span>
        {!open && <GroupMark state={mostUrgent(states.flatMap((state) => state ?? []))} />}
      </button>
      {open && rows}
    </div>
  );
}
