import { Icon } from '../terminal/Icon';
import type { ChatSessionInfo } from '../../chat/model';

/** What the agent left running between turns, each with a way to stop it. */
export function ChatBackground({ cardId, info }: { cardId: string; info: ChatSessionInfo }) {
  const tasks = info.background ?? [];
  if (tasks.length === 0) return null;

  return (
    <ul aria-label="Running in the background" className="mx-4 mb-2 flex flex-col gap-1">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-center gap-2.5 px-3 h-8 rounded-[10px] bg-ink/[0.04] text-[13px] text-text-secondary"
        >
          <Icon name={task.kind === 'shell' ? 'terminal' : 'users'} className="w-3.5 h-3.5 shrink-0" />
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
      ))}
    </ul>
  );
}
