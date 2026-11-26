import type { TaskStatus } from '../../types';

/** Column display names, as the "Move to" menu and its toasts write them. */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};
