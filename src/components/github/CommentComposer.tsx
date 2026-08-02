import { useState } from 'react';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Avatar } from './Avatar';

/**
 * Leave a comment on the pull request itself.
 *
 * One field with the send action inside it, rather than a textarea with a
 * button underneath: at rest it is a single line, and it grows only once there
 * is something in it worth growing for.
 */
export function CommentComposer({ projectPath, prNumber }: { projectPath: string; prNumber: number }) {
  const viewer = useGithubStore((s) => s.inbox?.viewer);
  const viewerAvatarUrl = useGithubStore((s) => s.inbox?.viewerAvatarUrl);
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
    <div className="flex items-end gap-2.5 pl-2.5 pr-2 py-2 rounded-[22px] bg-ink/[0.05] focus-within:bg-ink/[0.07] transition-colors duration-150">
      {viewer && <Avatar login={viewer} url={viewerAvatarUrl} size={24} className="mb-0.5" />}
      <textarea
        rows={body.includes('\n') || body.length > 80 ? 3 : 1}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post();
        }}
        placeholder="Leave a comment"
        className="flex-1 min-w-0 bg-transparent border-none outline-none resize-none text-[15px] leading-6 py-1 text-text-primary placeholder:text-text-tertiary"
      />
      <button
        type="button"
        disabled={!body.trim() || posting}
        title="Comment"
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-ink/[0.08] text-text-secondary transition-all duration-150 enabled:hover:bg-accent enabled:hover:text-accent-ink disabled:opacity-40"
        onClick={() => void post()}
      >
        <Icon name={posting ? 'arrows-clockwise' : 'arrow-up'} className="w-4 h-4" />
      </button>
    </div>
  );
}
