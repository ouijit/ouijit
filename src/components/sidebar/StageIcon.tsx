import type { TaskStatus } from '../../types';
import { STATUS_LABELS } from '../kanban/taskMenu';
import { Tooltip } from '../ui/Tooltip';

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
          style={{ color: 'color-mix(in srgb, var(--color-ink) 32%, transparent)' }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {status === 'todo' && (
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1" strokeDasharray="2.2 2" />
            )}
            {status === 'in_progress' && (
              <>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1" />
                <path d="M8 3.25a4.75 4.75 0 0 1 0 9.5z" fill="currentColor" />
              </>
            )}
            {status === 'in_review' && (
              <>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1" />
                <path d="M8 8V3.25A4.75 4.75 0 1 1 3.25 8z" fill="currentColor" />
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
