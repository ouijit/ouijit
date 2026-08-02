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
      {/* Every entry is a full-bleed block under a hairline, the same shape as
          a card in a board column. Nothing in here draws its own border: the
          panel is the surface, and boxes inside it would be a second one. */}
      <Entry author={detail.author} action={`opened this ${since(detail.createdAt)}`}>
        {detail.body.trim() ? (
          <Markdown body={detail.body} />
        ) : (
          <p className="font-mono text-[11px] text-text-tertiary">No description</p>
        )}
      </Entry>

      {unresolved.length > 0 && (
        <section>
          <SectionHeader label="Unresolved threads" count={unresolved.length} />
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

      {detail.timeline.map((item) =>
        item.kind === 'event' ? (
          <div
            key={item.id}
            className="flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] leading-tight text-text-secondary"
            style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
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

      <div className="px-3 py-3">
        <textarea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postComment();
          }}
          placeholder="Add a comment…"
          className="w-full text-sm bg-terminal-inset border border-ink/10 rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent resize-y"
        />
        <button
          type="button"
          disabled={!comment.trim() || posting}
          className="mt-2 font-mono text-[11px] leading-none px-3 py-1.5 rounded-full bg-accent text-accent-ink disabled:opacity-40"
          onClick={() => void postComment()}
        >
          {posting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

/** One authored block in the conversation: who, what they did, and the body. */
function Entry({ author, action, children }: { author: string; action: string; children?: React.ReactNode }) {
  return (
    <article
      className="px-3 py-3"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
    >
      <div className="flex items-center gap-1.5 font-mono text-[10px] leading-tight text-text-secondary">
        <span className="text-text-primary">{author}</span>
        <span className="opacity-30">·</span>
        <span className="opacity-70">{action}</span>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </article>
  );
}

/** Reads like a column header, because it is doing a column header's job. */
function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 h-[46px]"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
    >
      <span className="text-[13px] font-medium text-text-secondary tracking-wide">
        {label}
        <span className="text-text-secondary opacity-50 tracking-normal ml-1.5">{count}</span>
      </span>
    </div>
  );
}
