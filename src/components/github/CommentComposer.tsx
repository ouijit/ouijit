import { useState } from 'react';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Avatar } from './Avatar';

/**
 * Leave a comment on the pull request itself.
 *
 * A field and a button under it, the way every dialog in this app takes text.
 * The chat-bubble shape this replaced — a capsule with a circular send button
 * inside it — belongs to a messaging app; nothing else here is drawn that way.
 */
export function CommentComposer({ projectPath, prNumber }: { projectPath: string; prNumber: number }) {
  // From the pull request itself, which is always loaded when this renders.
  // Reading it off the inbox meant the box showed a placeholder whenever the
  // list had not been fetched.
  const viewer = useGithubStore((s) => s.detail?.viewer ?? s.inbox?.viewer);
  const viewerAvatarUrl = useGithubStore((s) => s.detail?.viewerAvatarUrl ?? s.inbox?.viewerAvatarUrl);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      const result = await window.api.github.comment(projectPath, prNumber, body);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not post the comment', 'error');
        return;
      }
      setBody('');
      await useGithubStore.getState().reloadDetail(projectPath);
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
          }}
          placeholder="Leave a comment"
          className="field resize-y"
        />
        {/* Offered once there is something to send. An always-live button
            beside an empty box is a control that mostly cannot be used. */}
        {body.trim() && (
          <button type="button" className="btn-primary btn-compact" disabled={posting} onClick={() => void post()}>
            {posting ? 'Posting…' : 'Comment'}
          </button>
        )}
      </div>
    </div>
  );
}
