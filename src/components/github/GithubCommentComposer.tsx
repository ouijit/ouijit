import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { CommentComposer } from '../issues/CommentComposer';

interface GithubCommentComposerProps {
  projectPath: string;
  number: number;
  /** Which thread the comment lands on, and therefore what to reload after. */
  subject: 'pr' | 'issue';
}

/**
 * One endpoint serves pull requests and issues alike — GitHub keeps pull
 * request conversation on the issue thread — so only the reload differs.
 */
export function GithubCommentComposer({ projectPath, number, subject }: GithubCommentComposerProps) {
  // From the open item, which is always loaded here; the inbox may not be, so
  // the box shows a placeholder until the list arrives.
  const viewer = useGithubStore((s) => s.detail?.viewer ?? s.issue?.viewer ?? s.inbox?.viewer);
  const viewerAvatarUrl = useGithubStore(
    (s) => s.detail?.viewerAvatarUrl ?? s.issue?.viewerAvatarUrl ?? s.inbox?.viewerAvatarUrl,
  );

  const post = async (body: string) => {
    const result = await window.api.github.comment(projectPath, number, body);
    if (!result.success) {
      useProjectStore.getState().addToast(result.error ?? 'Could not post the comment', 'error');
      return false;
    }
    const store = useGithubStore.getState();
    await (subject === 'issue' ? store.reloadIssue(projectPath) : store.reloadDetail(projectPath));
    return true;
  };

  return <CommentComposer viewer={viewer} viewerAvatarUrl={viewerAvatarUrl} onPost={post} />;
}
