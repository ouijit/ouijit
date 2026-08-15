import type { ReactNode } from 'react';
import { Icon } from '../terminal/Icon';

/**
 * One unsent thing in a menu of them, with where it points and a way to drop it.
 *
 * Shared by the pull request's unsent comments and the worktree diff's notes,
 * which are the same list of the same shape — an anchor, a body, and a discard
 * that only appears under the pointer.
 */
export function PendingRow({
  path,
  line,
  body,
  badge,
  onJump,
  onDiscard,
  discardTitle,
}: {
  path: string;
  line: number;
  body: string;
  /** Anything that qualifies the anchor — who wrote it, say. */
  badge?: ReactNode;
  onJump: () => void;
  onDiscard: () => void;
  discardTitle: string;
}) {
  return (
    <div className="group flex items-start gap-1">
      <button
        type="button"
        className="flex-1 min-w-0 text-left px-2.5 py-1.5 rounded-[7px] hover:bg-ink/[0.08]"
        onClick={onJump}
      >
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-tertiary truncate">
          <span className="truncate">
            {path}:{line}
          </span>
          {badge}
        </span>
        <span className="block text-[13px] text-text-secondary truncate">{body}</span>
      </button>
      <button
        type="button"
        className="shrink-0 w-6 h-6 mt-1.5 rounded flex items-center justify-center text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity duration-100"
        title={discardTitle}
        onClick={onDiscard}
      >
        <Icon name="x" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
