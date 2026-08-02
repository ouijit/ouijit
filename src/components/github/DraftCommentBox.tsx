import { useState } from 'react';
import type { ReviewDraft } from '../../github/types';

interface DraftCommentBoxProps {
  /** Set when editing an existing draft rather than starting a new one. */
  draft?: ReviewDraft;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
  onDiscard?: () => Promise<void>;
  placeholder?: string;
}

/**
 * The editor for one unsubmitted review comment.
 *
 * Saving stores the draft locally; nothing reaches GitHub until the review is
 * submitted as a batch. That is what lets a half-written review survive a
 * restart without creating a server-side pending review per edit.
 */
export function DraftCommentBox({
  draft,
  onSave,
  onCancel,
  onDiscard,
  placeholder = 'Leave a comment…',
}: DraftCommentBoxProps) {
  const [body, setBody] = useState(draft?.body ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-[90px] my-1 p-2 bg-terminal-surface border border-accent/40 rounded-md">
      <textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        className="w-full text-sm bg-terminal-inset border border-bezel rounded-md px-2 py-1.5 text-text-primary outline-none focus:border-accent resize-y font-sans"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          disabled={!body.trim() || busy}
          className="text-xs px-2.5 py-1 rounded-md bg-accent text-accent-ink disabled:opacity-40"
          onClick={() => void save()}
        >
          {draft ? 'Update comment' : 'Add comment'}
        </button>
        <button
          type="button"
          className="text-xs px-2.5 py-1 rounded-md text-text-tertiary hover:text-text-primary"
          onClick={onCancel}
        >
          Cancel
        </button>
        {onDiscard && (
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md text-vcs-deleted/80 hover:text-vcs-deleted ml-auto"
            onClick={() => void onDiscard()}
          >
            Discard
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-tertiary mt-1.5">Saved locally until you submit the review.</p>
    </div>
  );
}
