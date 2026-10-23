import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ContextMenuEntry } from '../ui/ContextMenu';
import { collectActiveTags, tagUnit, useTerminalStore, withTag, withoutTag } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { loadTasks } from '../../stores/projectDataStore';
import { terminalInstances } from '../terminal/terminalRegistry';
import { closeProjectTerminal } from '../terminal/terminalActions';
import { moveToEntry, STATUS_LABELS } from '../kanban/taskMenu';
import type { TaskStatus } from '../../types';

function updateTags(ptyIds: string[], update: (tags: string[]) => string[]): void {
  for (const id of ptyIds) {
    const instance = terminalInstances.get(id);
    instance?.setTags(update(instance.tags));
  }
}

/** The tasks these terminals belong to, once each. */
function tasksOf(ptyIds: string[]): { projectPath: string; taskNumber: number }[] {
  const { displayStates } = useTerminalStore.getState();
  const seen = new Map<string, { projectPath: string; taskNumber: number }>();
  for (const id of ptyIds) {
    const display = displayStates[id];
    if (display?.taskId == null) continue;
    seen.set(`${display.projectPath}#${display.taskId}`, {
      projectPath: display.projectPath,
      taskNumber: display.taskId,
    });
  }
  return [...seen.values()];
}

async function eachTask(
  tasks: { projectPath: string; taskNumber: number }[],
  run: (projectPath: string, taskNumber: number) => Promise<unknown>,
  toast: string,
): Promise<void> {
  await Promise.allSettled(tasks.map((t) => run(t.projectPath, t.taskNumber)));
  for (const projectPath of new Set(tasks.map((t) => t.projectPath))) loadTasks(projectPath);
  useProjectStore.getState().addToast(toast, 'success');
}

/** What right-clicking a row of a stack of several offers: the same, once, for everything in it. */
export function selectionEntries(ptyIds: string[], newTag: () => void): ContextMenuEntry[] {
  const { order, displayStates } = useTerminalStore.getState();
  const tasks = tasksOf(ptyIds);
  const noun = (n: number) => (n === 1 ? 'task' : 'tasks');
  const shared = (tag: string) =>
    ptyIds.every((id) => displayStates[id]?.tags.some((t) => tagUnit(t) === tagUnit(tag)));
  const entries: ContextMenuEntry[] = [];

  if (tasks.length > 0) {
    entries.push(
      moveToEntry({
        setStatus: (status: TaskStatus) =>
          void eachTask(
            tasks,
            (path, n) => window.api.task.setStatus(path, n, status),
            `Moved ${tasks.length} ${noun(tasks.length)} to ${STATUS_LABELS[status]}`,
          ),
        trash: () =>
          void eachTask(
            tasks,
            (path, n) => window.api.task.trash(path, n),
            `Moved ${tasks.length} ${noun(tasks.length)} to trash`,
          ),
      }),
    );
  }

  const known = collectActiveTags(order, displayStates);
  entries.push({
    label: 'Tag',
    icon: 'tag',
    submenu: [
      ...known.map((tag) => ({
        label: tag,
        checked: shared(tag),
        onClick: () => updateTags(ptyIds, (tags) => (shared(tag) ? withoutTag(tags, tag) : withTag(tags, tag))),
      })),
      ...(known.length > 0 ? [{ separator: true as const }] : []),
      { label: 'New tag…', icon: 'plus', onClick: newTag },
      ...(ptyIds.some((id) => displayStates[id]?.tags.length)
        ? [{ label: 'Clear tags', icon: 'x', onClick: () => updateTags(ptyIds, () => []) }]
        : []),
    ],
  });

  entries.push(
    { separator: true },
    {
      label: `Close ${ptyIds.length} terminals`,
      icon: 'x',
      onClick: () => {
        for (const id of ptyIds) closeProjectTerminal(id);
      },
    },
  );
  return entries;
}

/** Names a new tag for the terminals of a selection, where the menu was. */
export function TagPrompt({ x, y, ptyIds, onClose }: { x: number; y: number; ptyIds: string[]; onClose: () => void }) {
  const [value, setValue] = useState('');
  return createPortal(
    <input
      autoFocus
      aria-label="New tag"
      placeholder="Tag"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          updateTags(ptyIds, (tags) => withTag(tags, value));
          onClose();
        }
        if (e.key === 'Escape') onClose();
      }}
      className="fixed z-[10010] w-44 h-7 px-2 rounded-[7px] border border-bezel-panel text-[13px] text-text-primary outline-none"
      style={{ left: x, top: y, background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    />,
    document.body,
  );
}
