import { useCallback, useState } from 'react';
import type { PullRequestDetail, ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Markdown } from './Markdown';
import { ReviewThreadView } from './ReviewThreadView';
import { Band, Entry, SECTION_IDS } from './DocumentSection';
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

  const entries = detail.timeline.length + unresolved.length;
  const summary =
    unresolved.length > 0
      ? `${unresolved.length} unresolved`
      : entries === 0
        ? 'nothing said yet'
        : `${entries} ${entries === 1 ? 'entry' : 'entries'}`;

  return (
    // Open only when something is outstanding. A long timeline sitting above
    // the diff is exactly the cost of reading a pull request as one document,
    // and it is only worth paying when there is an obligation in it.
    <Band id={SECTION_IDS.discussion} label="Discussion" summary={summary} defaultOpen={unresolved.length > 0}>
      {unresolved.map((thread) => (
        <ReviewThreadView key={thread.id} thread={thread} onReply={replyToThread} onToggleResolved={toggleResolved} />
      ))}

      {detail.timeline.map((item) =>
        item.kind === 'event' ? (
          <div
            key={item.id}
            className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] leading-tight text-text-secondary"
          >
            <Icon name="git-commit" className="w-3 h-3 shrink-0 opacity-60" />
            <span>{item.author}</span>
            <span className="opacity-30">·</span>
            <span className="opacity-70">{item.eventType}</span>
            <span className="opacity-30">·</span>
            <span className="opacity-70">{since(item.createdAt)}</span>
          </div>
        ) : (
          <Entry
            key={item.id}
            author={item.author}
            action={`${item.kind === 'review' ? reviewStateLabel(item.reviewState) : 'commented'} ${since(item.createdAt)}`}
          >
            {item.body.trim() && <Markdown body={item.body} />}
          </Entry>
        ),
      )}

      <div className="px-3 py-2.5 flex flex-col items-start gap-2">
        <textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postComment();
          }}
          placeholder="Add a comment…"
          className="w-full text-sm bg-terminal-inset border border-ink/10 rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent resize-y"
        />
        {/* Only offered once there is something to send: an always-live button
            beside an empty box is a control that mostly cannot be used. */}
        {comment.trim() && (
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={posting}
            onClick={() => void postComment()}
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
        )}
      </div>
    </Band>
  );
}
