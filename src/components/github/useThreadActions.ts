import { useMemo } from 'react';
import type { ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';

/**
 * Replying to a thread and resolving one, wherever a thread is rendered.
 *
 * The same threads appear twice — against their line in the diff, and gathered
 * as the outstanding ones on the timeline — and both places offer these two
 * actions.
 */
export function useThreadActions(
  projectPath: string,
  prNumber: number,
): {
  replyToThread: (thread: ReviewThread, body: string) => Promise<void>;
  toggleResolved: (thread: ReviewThread) => Promise<void>;
} {
  return useMemo(
    () => ({
      replyToThread: async (thread: ReviewThread, body: string) => {
        const target = thread.comments[thread.comments.length - 1] ?? thread.comments[0];
        if (!target?.databaseId) {
          useProjectStore.getState().addToast('Could not find the comment to reply to', 'error');
          return;
        }
        const result = await window.api.github.replyToThread(projectPath, prNumber, target.databaseId, body);
        if (!result.success) {
          // The reply box clears on return, so a silent failure would lose the
          // typed text.
          useProjectStore.getState().addToast(result.error ?? 'Reply failed', 'error');
          return;
        }
        await useGithubStore.getState().reloadDetail(projectPath);
      },

      toggleResolved: async (thread: ReviewThread) => {
        const result = await window.api.github.resolveThread(projectPath, thread.id, !thread.isResolved);
        if (!result.success) {
          useProjectStore.getState().addToast(result.error ?? 'Could not update the thread', 'error');
          return;
        }
        await useGithubStore.getState().reloadDetail(projectPath);
      },
    }),
    [projectPath, prNumber],
  );
}
