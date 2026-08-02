import { useState } from 'react';
import type { ReviewDraft, ReviewEvent } from '../../github/types';
import { Icon } from '../terminal/Icon';

interface ReviewComposerProps {
  drafts: ReviewDraft[];
  /** The viewer authored this PR — GitHub rejects self approve / request-changes. */
  isOwnPullRequest: boolean;
  submitting: boolean;
  onSubmit: (event: ReviewEvent, body: string) => Promise<void>;
  onJumpToDraft: (draft: ReviewDraft) => void;
  onDiscardDraft: (draft: ReviewDraft) => Promise<void>;
}

/**
 * The batch review bar: every pending draft, plus the three ways to send them.
 *
 * Sits at the bottom of the files view whenever there is unsent work, so the
 * count of what you've written is always visible rather than buried in the
 * diff you've scrolled past.
 */
export function ReviewComposer({
  drafts,
  isOwnPullRequest,
  submitting,
  onSubmit,
  onJumpToDraft,
  onDiscardDraft,
}: ReviewComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');

  const submit = async (event: ReviewEvent) => {
    await onSubmit(event, body);
    setBody('');
    setExpanded(false);
  };

  return (
    <div className="shrink-0 border-t border-ink/[0.06] bg-background-secondary">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors duration-100"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'caret-down' : 'caret-up'} className="!w-3 !h-3" />
        <span>
          {drafts.length} pending {drafts.length === 1 ? 'comment' : 'comments'}
        </span>
        <span className="ml-auto text-xs text-text-tertiary">Review</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          {drafts.length > 0 && (
            <ul className="mb-3 divide-y divide-ink/[0.06] border border-ink/10 rounded-md overflow-hidden">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left hover:text-text-primary"
                    onClick={() => onJumpToDraft(draft)}
                  >
                    <span className="font-mono text-text-tertiary">
                      {draft.path}:{draft.line}
                    </span>
                    <span className="block text-text-secondary truncate mt-0.5">{draft.body}</span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 text-text-tertiary hover:text-vcs-deleted"
                    title="Discard this comment"
                    onClick={() => void onDiscardDraft(draft)}
                  >
                    <Icon name="x" className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Review summary (optional)"
            className="w-full text-sm bg-terminal-inset border border-ink/10 rounded-md px-2 py-1.5 text-text-primary outline-none focus:border-accent resize-y"
          />

          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              disabled={submitting}
              className="text-xs px-3 py-1.5 rounded-md bg-ink/[0.08] text-text-primary hover:bg-ink/[0.12] disabled:opacity-40"
              onClick={() => void submit('COMMENT')}
            >
              Comment
            </button>
            <button
              type="button"
              disabled={submitting || isOwnPullRequest}
              title={isOwnPullRequest ? 'GitHub does not allow approving your own pull request' : undefined}
              className="text-xs px-3 py-1.5 rounded-md bg-vcs-added/15 text-vcs-added hover:bg-vcs-added/25 disabled:opacity-40"
              onClick={() => void submit('APPROVE')}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={submitting || isOwnPullRequest}
              title={isOwnPullRequest ? 'GitHub does not allow requesting changes on your own pull request' : undefined}
              className="text-xs px-3 py-1.5 rounded-md bg-vcs-deleted/15 text-vcs-deleted hover:bg-vcs-deleted/25 disabled:opacity-40"
              onClick={() => void submit('REQUEST_CHANGES')}
            >
              Request changes
            </button>
            {submitting && <span className="text-xs text-text-tertiary">Submitting…</span>}
          </div>
        </div>
      )}
    </div>
  );
}
