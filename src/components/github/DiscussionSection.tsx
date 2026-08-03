import { useCallback } from 'react';
import type { PullRequestDetail, ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { CommentComposer } from './CommentComposer';
import { ReviewThreadView } from './ReviewThreadView';
import { TimelineEntries } from './TimelineEntries';

interface DiscussionSectionProps {
  projectPath: string;
  detail: PullRequestDetail;
}

/**
 * Timeline, unresolved threads, and the box for a top-level comment.
 *
 * Threads anchored to a line render against that line further down the
 * document; the ones repeated here are the unresolved ones, which are the
 * outstanding obligations on the change and should not require finding the
 * right hunk to discover.
 */
export function DiscussionSection({ projectPath, detail }: DiscussionSectionProps) {
  const unresolved = detail.threads.filter((t) => !t.isResolved);

  const replyToThread = useCallback(
    async (thread: ReviewThread, body: string) => {
      const target = thread.comments[thread.comments.length - 1] ?? thread.comments[0];
      if (!target?.databaseId) {
        useProjectStore.getState().addToast('Could not find the comment to reply to', 'error');
        return;
      }
      const result = await window.api.github.replyToThread(projectPath, detail.number, target.databaseId, body);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Reply failed', 'error');
        return;
      }
      await useGithubStore.getState().reloadDetail(projectPath);
    },
    [projectPath, detail.number],
  );

  const toggleResolved = useCallback(
    async (thread: ReviewThread) => {
      const result = await window.api.github.resolveThread(projectPath, thread.id, !thread.isResolved);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not update the thread', 'error');
        return;
      }
      await useGithubStore.getState().reloadDetail(projectPath);
    },
    [projectPath],
  );

  const entries = detail.timeline.length + unresolved.length;

  return (
    <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-6">
      {unresolved.length > 0 && (
        <section className="flex flex-col gap-6">
          <h2 className="text-[19px] font-medium text-text-primary pb-2.5 border-b border-ink/[0.08]">
            Unresolved
            <span className="ml-2 text-[15px] text-text-tertiary">{unresolved.length}</span>
          </h2>
          {unresolved.map((thread) => (
            <ReviewThreadView
              key={thread.id}
              thread={thread}
              onReply={replyToThread}
              onToggleResolved={toggleResolved}
            />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-5">
        {detail.timeline.length > 0 && (
          <h2 className="text-[19px] font-medium text-text-primary pb-2.5 border-b border-ink/[0.08]">Timeline</h2>
        )}
        <TimelineEntries
          items={detail.timeline}
          empty={entries === 0 ? 'Nothing has been said about this change' : undefined}
        />
      </section>

      <CommentComposer projectPath={projectPath} number={detail.number} subject="pr" />
    </div>
  );
}
