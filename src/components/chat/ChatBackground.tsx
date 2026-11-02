import { useState } from 'react';
import { Icon } from '../terminal/Icon';
import type { ChatBackgroundTask, ChatSessionInfo } from '../../chat/model';

function TaskRow({ cardId, task }: { cardId: string; task: ChatBackgroundTask }) {
  return (
    <li className="flex items-center gap-2.5 px-3 h-8 text-[13px] text-text-secondary">
      <Icon name={task.kind === 'shell' ? 'terminal' : 'flow-arrow'} className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 min-w-0 truncate">{task.description}</span>
      <button
        type="button"
        aria-label={`Stop ${task.description}`}
        className="text-text-tertiary hover:text-text-primary transition-colors duration-100"
        onClick={() => void window.api.chat.stopBackground(cardId, task.id)}
      >
        Stop
      </button>
    </li>
  );
}

/**
 * What the agent left running between turns, each with a way to stop it. More
 * than one folds behind a count, so a fan-out of subagents does not push the
 * transcript off the card.
 */
export function ChatBackground({ cardId, info }: { cardId: string; info: ChatSessionInfo }) {
  const [open, setOpen] = useState(false);
  const tasks = info.background ?? [];
  if (tasks.length === 0) return null;

  if (tasks.length === 1) {
    return (
      <ul aria-label="Running in the background" className="mx-4 mb-2 rounded-[10px] bg-ink/[0.04]">
        <TaskRow cardId={cardId} task={tasks[0]} />
      </ul>
    );
  }

  return (
    <div className="mx-4 mb-2 rounded-[10px] bg-ink/[0.04]">
      <button
        type="button"
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3 h-8 text-[13px] text-text-secondary hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex-1 text-left">{tasks.length} running in the background</span>
        <Icon
          name="caret-down"
          className={`w-3 h-3 text-text-tertiary transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <ul aria-label="Running in the background" className="max-h-40 overflow-y-auto border-t border-separator">
          {tasks.map((task) => (
            <TaskRow key={task.id} cardId={cardId} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}
