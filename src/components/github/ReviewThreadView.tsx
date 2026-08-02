import { useState } from 'react';
import type { ReviewThread } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { Markdown } from './Markdown';
import { since } from './prFormat';

interface ReviewThreadViewProps {
  thread: ReviewThread;
  onReply: (thread: ReviewThread, body: string) => Promise<void>;
  onToggleResolved: (thread: ReviewThread) => Promise<void>;
  /** Rendered inline in the diff rather than in a list — tightens the chrome. */
  inline?: boolean;
}

/**
 * One review thread and its replies.
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

  return (
    // Inline in a diff, the thread is an insert into a code stream and keeps
    // its own frame. In the conversation it is one entry among others, so it
    // runs full bleed under the same hairline everything else there uses.
    <div
      className={`bg-terminal-surface border-l-2 ${thread.isResolved ? 'border-vcs-added/40' : 'border-accent/60'} ${
        inline ? 'mx-[90px] my-1 rounded-r-md border-y border-r border-ink/[0.06]' : 'border-b border-ink/[0.06]'
      } overflow-hidden`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-tertiary border-b border-ink/[0.06]">
        <button
          type="button"
          className="flex items-center gap-1 hover:text-text-primary transition-colors duration-100"
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon name={collapsed ? 'caret-right' : 'caret-down'} className="!w-3 !h-3" />
          <span>
            {thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}
          </span>
        </button>
        {!inline && (
          <span className="font-mono truncate">
            {thread.path}
            {anchorLine != null && `:${anchorLine}`}
          </span>
        )}
        {thread.isOutdated && (
          <span
            className="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-vcs-modified/15 text-vcs-modified"
            title={`Written against line ${thread.originalLine ?? '?'}, which has since changed`}
          >
            outdated
          </span>
        )}
        {thread.isResolved && (
          <span className="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-vcs-added/15 text-vcs-added">
            resolved
          </span>
        )}
        <button
          type="button"
          className="ml-auto shrink-0 hover:text-text-primary transition-colors duration-100"
          onClick={() => void onToggleResolved(thread)}
        >
          {thread.isResolved ? 'Unresolve' : 'Resolve'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="divide-y divide-ink/[0.06]">
            {thread.comments.map((comment) => (
              <div key={comment.id} className="px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-text-tertiary mb-1">
                  <span className="text-text-secondary">{comment.author}</span>
                  <span>{since(comment.createdAt)}</span>
                </div>
                <Markdown body={comment.body} />
              </div>
            ))}
          </div>

          {replying ? (
            <div className="p-2 border-t border-ink/[0.06]">
              <textarea
                autoFocus
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitReply();
                  if (e.key === 'Escape') setReplying(false);
                }}
                placeholder="Reply…"
                className="w-full text-sm bg-terminal-inset border border-ink/10 rounded-md px-2 py-1.5 text-text-primary outline-none focus:border-accent resize-y"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  disabled={!body.trim() || busy}
                  className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-ink disabled:opacity-40"
                  onClick={() => void submitReply()}
                >
                  {busy ? 'Sending…' : 'Reply'}
                </button>
                <button
                  type="button"
                  className="text-xs px-2.5 py-1 rounded-md text-text-tertiary hover:text-text-primary"
                  onClick={() => setReplying(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs text-text-tertiary hover:text-text-primary hover:bg-ink/[0.03] border-t border-ink/[0.06] transition-colors duration-100"
              onClick={() => setReplying(true)}
            >
              Reply…
            </button>
          )}
        </>
      )}
    </div>
  );
}
