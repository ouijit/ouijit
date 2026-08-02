import { useCallback, useState } from 'react';
import type { PullRequestDetail, ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Markdown } from './Markdown';
import { ReviewThreadView } from './ReviewThreadView';
import { reviewStateLabel, since } from './prFormat';

interface PullRequestConversationProps {
  projectPath: string;
  detail: PullRequestDetail;
}

/**
 * Description, timeline, and unresolved threads, plus a box to add a top-level
 * comment. The threads shown here are the ones still open — resolved ones stay
 * in the files view where the code gives them context.
 */
export function PullRequestConversation({ projectPath, detail }: PullRequestConversationProps) {
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);

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

  const postComment = async () => {
    if (!comment.trim() || posting) return;
    setPosting(true);
    try {
      const result = await window.api.github.comment(projectPath, detail.number, comment);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not post the comment', 'error');
        return;
      }
      setComment('');
      await useGithubStore.getState().reloadDetail(projectPath);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-4 flex flex-col gap-4 pb-16">
        <article className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden bg-terminal-bg">
          <header className="flex items-center gap-2 px-4 py-2 text-xs text-text-tertiary border-b border-ink/[0.06]">
            <span className="text-text-secondary">{detail.author}</span>
            <span>opened this {since(detail.createdAt)}</span>
          </header>
          <div className="px-4 py-3">
            {detail.body.trim() ? (
              <Markdown body={detail.body} />
            ) : (
              <p className="text-sm text-text-tertiary italic">No description</p>
            )}
          </div>
        </article>

        {unresolved.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-text-tertiary mb-2">
              Unresolved threads
              <span className="ml-2 font-normal opacity-60">{unresolved.length}</span>
            </h3>
            <div className="flex flex-col gap-2">
              {unresolved.map((thread) => (
                <ReviewThreadView
                  key={thread.id}
                  thread={thread}
                  onReply={replyToThread}
                  onToggleResolved={toggleResolved}
                />
              ))}
            </div>
          </section>
        )}

        {detail.timeline.length > 0 && (
          <section className="flex flex-col gap-3">
            {detail.timeline.map((item) =>
              item.kind === 'event' ? (
                <div key={item.id} className="flex items-center gap-2 text-xs text-text-tertiary px-1">
                  <Icon name="git-commit" className="w-3.5 h-3.5" />
                  <span className="text-text-secondary">{item.author}</span>
                  <span>{item.eventType}</span>
                  <span>{since(item.createdAt)}</span>
                </div>
              ) : (
                <article
                  key={item.id}
                  className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden bg-terminal-bg"
                >
                  <header className="flex items-center gap-2 px-4 py-2 text-xs text-text-tertiary border-b border-ink/[0.06]">
                    <span className="text-text-secondary">{item.author}</span>
                    <span>{item.kind === 'review' ? reviewStateLabel(item.reviewState) : 'commented'}</span>
                    <span>{since(item.createdAt)}</span>
                  </header>
                  {item.body.trim() && (
                    <div className="px-4 py-3">
                      <Markdown body={item.body} />
                    </div>
                  )}
                </article>
              ),
            )}
          </section>
        )}

        <div>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postComment();
            }}
            placeholder="Add a comment…"
            className="w-full text-sm bg-terminal-inset border border-bezel rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent resize-y"
          />
          <button
            type="button"
            disabled={!comment.trim() || posting}
            className="mt-2 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-ink disabled:opacity-40"
            onClick={() => void postComment()}
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
