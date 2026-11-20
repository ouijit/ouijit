import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '../terminal/Icon';
import { useAsking, wantsYou } from '../terminal/wantsYou';
import { GroupMark, IdleMark, SidebarRow, mostUrgent, useProjectName, type GroupState } from '../sidebar/SidebarRows';
import { StageIcon } from '../sidebar/StageIcon';
import { focusTerminal, openTaskTerminal } from '../navigation';
import { useAppStore } from '../../stores/appStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import { useTerminalStore } from '../../stores/terminalStore';
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

function ManagedRow({ managed, state }: { managed: Managed; state: GroupState | null }) {
  const { projectPath, task } = managed;
  const projectName = useProjectName(projectPath);
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
      unread={state === 'unread'}
      detail={projectName}
      trailing={state ? <GroupMark state={state} /> : <IdleMark />}
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
      <div aria-label="Tasks Chat is managing" className="mx-4 mb-2 p-0.5 rounded-[10px] bg-ink/[0.04]">
        {rows}
      </div>
    );
  }
  return (
    <div aria-label="Tasks Chat is managing" className="mx-4 mb-2 p-0.5 rounded-[10px] bg-ink/[0.04]">
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
