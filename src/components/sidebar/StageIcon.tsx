import type { TaskStatus } from '../../types';
import { STATUS_LABELS } from '../kanban/taskMenu';
import { Tooltip } from '../ui/Tooltip';

const QUIET = 'color-mix(in srgb, var(--color-ink) 32%, transparent)';

/** Muted hues the status dots beside them don't use. */
const STAGE_COLORS: Record<TaskStatus, string> = {
  todo: QUIET,
  in_progress: 'color-mix(in srgb, var(--color-ansi-yellow) 70%, transparent)',
  in_review: 'color-mix(in srgb, var(--color-ansi-cyan) 70%, transparent)',
  done: QUIET,
};

/** Which board column a task is in, quieter than the titles and status dots beside it. */
export function StageIcon({ status }: { status: TaskStatus }) {
  return (
    <Tooltip text={STATUS_LABELS[status]} placement="top" delay={300}>
      {(ref, props) => (
        <span
          ref={ref}
          {...props}
          role="img"
          aria-label={STATUS_LABELS[status]}
          className="w-3.5 h-3.5 flex items-center justify-center shrink-0"
          style={{ color: STAGE_COLORS[status] }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {status === 'todo' && (
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" />
            )}
            {status === 'in_progress' && (
              <>
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
              </>
            )}
            {status === 'in_review' && (
              <>
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 8V4.5A3.5 3.5 0 1 1 4.5 8z" fill="currentColor" />
              </>
            )}
            {status === 'done' && (
              <>
                <circle cx="8" cy="8" r="6.25" fill="currentColor" />
                <path
                  d="M5.5 8.2l1.8 1.8 3.4-3.6"
                  stroke="var(--sidebar-bg)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            )}
          </svg>
        </span>
      )}
    </Tooltip>
  );
}
