import { useState } from 'react';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Avatar } from './Avatar';

interface CommentComposerProps {
  projectPath: string;
  number: number;
  /** Which thread the comment lands on, and therefore what to reload after. */
  subject: 'pr' | 'issue';
}

/**
 * One endpoint serves pull requests and issues alike — GitHub keeps pull
 * request conversation on the issue thread — so only the reload differs.
 */
export function CommentComposer({ projectPath, number, subject }: CommentComposerProps) {
  // From the open item, which is always loaded here; the inbox may not be, so
  // the box shows a placeholder until the list arrives.
  const viewer = useGithubStore((s) => s.detail?.viewer ?? s.issue?.viewer ?? s.inbox?.viewer);
  const viewerAvatarUrl = useGithubStore(
    (s) => s.detail?.viewerAvatarUrl ?? s.issue?.viewerAvatarUrl ?? s.inbox?.viewerAvatarUrl,
  );
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      const result = await window.api.github.comment(projectPath, number, body);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not post the comment', 'error');
        return;
      }
      setBody('');
      const store = useGithubStore.getState();
      await (subject === 'issue' ? store.reloadIssue(projectPath) : store.reloadDetail(projectPath));
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
