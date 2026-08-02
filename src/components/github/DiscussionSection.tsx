import { useCallback } from 'react';
import type { PullRequestDetail, ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Markdown } from './Markdown';
import { CommentComposer } from './CommentComposer';
import { ReviewThreadView } from './ReviewThreadView';
import { reviewStateLabel, since } from './prFormat';

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
        <section className="flex flex-col gap-3">
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

        {detail.timeline.map((item) =>
          item.kind === 'event' ? (
            <div key={item.id} className="flex items-center gap-2 text-[13px] text-text-tertiary">
              <Icon name="git-commit" className="w-4 h-4 shrink-0 opacity-60" />
              <span className="text-text-secondary">{item.author}</span>
              <span>{item.eventType}</span>
              <span className="opacity-50">·</span>
              <span>{since(item.createdAt)}</span>
            </div>
          ) : (
            <article key={item.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
                <span className="text-text-primary text-[15px]">{item.author}</span>
                <span>{item.kind === 'review' ? reviewStateLabel(item.reviewState) : 'commented'}</span>
                <span className="opacity-50">·</span>
                <span>{since(item.createdAt)}</span>
              </div>
              {item.body.trim() && <Markdown body={item.body} />}
            </article>
          ),
        )}

        {entries === 0 && <p className="text-[15px] text-text-tertiary">Nothing has been said about this change</p>}
      </section>

      <CommentComposer projectPath={projectPath} prNumber={detail.number} />
    </div>
  );
}
