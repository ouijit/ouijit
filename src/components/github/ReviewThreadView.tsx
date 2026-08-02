import { useState } from 'react';
import type { ReviewThread } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { Avatar } from './Avatar';
import { Markdown } from './Markdown';
import { since } from './prFormat';

interface ReviewThreadViewProps {
  thread: ReviewThread;
  onReply: (thread: ReviewThread, body: string) => Promise<void>;
  onToggleResolved: (thread: ReviewThread) => Promise<void>;
  /** Rendered inline in the diff rather than in a list — needs its own frame. */
  inline?: boolean;
}

/**
 * One review thread and its replies.
 *
 * In the timeline this is not a card: it is the same avatar-and-column shape
 * every other comment there uses, with a quiet line naming the code it hangs
 * off. A filled box with its own rules was a second surface inside the panel
 * and read as a foreign object.
 *
 * Inline in a diff it does keep a frame, because there it is an insert into a
 * stream of code and needs to be told apart from it.
 *
 * An outdated thread — the head moved past the lines it was left on — stays
 * rendered in place rather than being collapsed away, but says so and shows the
 * line it was originally written against. Hiding it would lose the one piece of
 * context that explains why the comment reads oddly against the current code.
 */
export function ReviewThreadView({ thread, onReply, onToggleResolved, inline = false }: ReviewThreadViewProps) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(thread.isResolved);

  const submitReply = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onReply(thread, body);
      setBody('');
      setReplying(false);
    } finally {
      setBusy(false);
    }
  };

  const anchorLine = thread.line ?? thread.originalLine;

  const header = (
    <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
      <button
        type="button"
        className="flex items-center gap-1.5 hover:text-text-primary transition-colors duration-100"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Icon
          name="caret-right"
          className={`w-3 h-3 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
        />
        {!inline && (
          <span className="font-mono text-[12px]">
            {thread.path}
            {anchorLine != null && `:${anchorLine}`}
          </span>
        )}
        {inline && (
          <span>
            {thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}
          </span>
        )}
      </button>

      {thread.isOutdated && (
        <span
          className="shrink-0 text-[11px] text-vcs-modified"
          title={`Written against line ${thread.originalLine ?? '?'}, which has since changed`}
        >
          outdated
        </span>
      )}
      {thread.isResolved && <span className="shrink-0 text-[11px] text-vcs-added">resolved</span>}

      <button
        type="button"
        className="ml-auto shrink-0 hover:text-text-primary transition-colors duration-100"
        onClick={() => void onToggleResolved(thread)}
      >
        {thread.isResolved ? 'Unresolve' : 'Resolve'}
      </button>
    </div>
  );

  const comments = thread.comments.map((comment) => (
    <div key={comment.id} className="flex gap-3">
      <Avatar login={comment.author} url={comment.authorAvatarUrl} size={inline ? 20 : 26} className="mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
          <span className={inline ? 'text-text-secondary' : 'text-text-primary text-[15px]'}>{comment.author}</span>
          <span className="opacity-50">·</span>
          <span>{since(comment.createdAt)}</span>
        </div>
        <Markdown body={comment.body} />
      </div>
    </div>
  ));

  const reply = replying ? (
    <div className="flex flex-col items-start gap-2">
      <textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitReply();
          if (e.key === 'Escape') setReplying(false);
        }}
        placeholder="Reply"
        className="field resize-y"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!body.trim() || busy}
          className="btn-primary btn-compact"
          onClick={() => void submitReply()}
        >
          {busy ? 'Sending…' : 'Reply'}
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => setReplying(false)}>
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      className="self-start text-[13px] text-text-tertiary hover:text-text-primary transition-colors duration-100"
      onClick={() => setReplying(true)}
    >
      Reply
    </button>
  );

  if (!inline) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {!collapsed && comments}
        {!collapsed && reply}
      </div>
    );
  }

  return (
    // No left bar: the fill and the gutter offset already tell it apart from
    // the code around it, and a coloured rule down the side of every thread
    // made a reviewed file look striped.
    <div className="mx-[88px] my-1.5 rounded-md bg-terminal-surface">
      <div className="flex flex-col gap-2.5 px-3 py-2">
        {header}
        {!collapsed && comments}
        {!collapsed && reply}
      </div>
    </div>
  );
}
