import { useState } from 'react';
import { Avatar } from './Avatar';

interface CommentComposerProps {
  /** Who is writing, for the face beside the box. Absent until the source knows. */
  viewer?: string;
  viewerAvatarUrl?: string;
  /**
   * Posts the comment and refreshes whatever is open. False leaves the text in
   * the box, so a failed post is not also a lost comment.
   */
  onPost: (body: string) => Promise<boolean>;
}

/**
 * The comment box, over any source. What posting means is the caller's: GitHub
 * keeps pull request conversation on the issue thread, Linear has its own
 * mutation, and only they know what to reload afterwards.
 */
export function CommentComposer({ viewer, viewerAvatarUrl, onPost }: CommentComposerProps) {
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      if (await onPost(body)) setBody('');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex gap-3">
      {viewer && <Avatar login={viewer} url={viewerAvatarUrl} size={26} className="mt-1" />}
      <div className="flex-1 min-w-0 flex flex-col items-start gap-2">
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post();
            if (e.key === 'Escape') {
              // Claim it, or the panel's own Escape handler closes the pull
              // request out from under a comment being written.
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder="Leave a comment"
          className="field resize-y"
        />
        {body.trim() && (
          <button type="button" className="btn-primary btn-compact" disabled={posting} onClick={() => void post()}>
            {posting ? 'Posting…' : 'Comment'}
          </button>
        )}
      </div>
    </div>
  );
}
