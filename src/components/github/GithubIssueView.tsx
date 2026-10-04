import type { IssueDetail } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore } from '../../stores/githubStore';
import { Avatar } from '../issues/Avatar';
import { Fact, LabelChips } from '../issues/Sections';
import { IssueDetailView } from '../issues/IssueDetailView';
import { GithubCommentComposer } from './GithubCommentComposer';

interface GithubIssueViewProps {
  projectPath: string;
  issue: IssueDetail;
  linkedTask?: TaskWithWorkspace;
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: () => void;
}

/** One GitHub issue, in the shared detail view. */
export function GithubIssueView({
  projectPath,
  issue,
  linkedTask,
  openTaskLabel,
  onOpenTask,
  onCreateTask,
}: GithubIssueViewProps) {
  const loading = useGithubStore((s) => s.issueLoading);
  const open = issue.state === 'open';
  const comments = issue.timeline.filter((i) => i.kind !== 'event');

  return (
    <IssueDetailView
      title={issue.title}
      identifier={`#${issue.number}`}
      url={issue.url}
      icon={open ? 'circle-dashed' : 'check-circle'}
      tone={open ? 'text-vcs-added' : 'text-vcs-renamed'}
      stateLabel={stateLabel(issue)}
      author={issue.author}
      authorAvatarUrl={issue.authorAvatarUrl}
      createdAt={issue.createdAt}
      body={issue.body}
      timeline={issue.timeline}
      loading={loading}
      onRefresh={() => void useGithubStore.getState().reloadIssue(projectPath)}
      onClose={() => useGithubStore.getState().closeDetail()}
      linkedTask={linkedTask}
      openTaskLabel={openTaskLabel}
      onOpenTask={onOpenTask}
      onCreateTask={onCreateTask}
      composer={<GithubCommentComposer projectPath={projectPath} number={issue.number} subject="issue" />}
      facts={
        <>
          <Fact icon="users" label="Assignees">
            {issue.assignees.length === 0 ? (
              <span className="text-text-tertiary">Nobody</span>
            ) : (
              issue.assignees.map((login) => (
                <span key={login} className="flex items-center gap-1.5 text-text-primary">
                  <Avatar login={login} size={18} />
                  {login}
                </span>
              ))
            )}
          </Fact>

          <Fact icon="tag" label="Labels">
            {issue.labels.length === 0 ? (
              <span className="text-text-tertiary">None</span>
            ) : (
              <LabelChips labels={issue.labels} />
            )}
          </Fact>

          <Fact icon="chat-circle" label="Comments">
            <span className={comments.length === 0 ? 'text-text-tertiary' : 'text-text-primary'}>
              {comments.length === 0
                ? 'No comments'
                : `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`}
            </span>
          </Fact>
        </>
      }
    />
  );
}

function stateLabel(issue: IssueDetail): string {
  if (issue.state === 'open') return 'Open';
  return issue.stateReason === 'NOT_PLANNED' ? 'Closed as not planned' : 'Closed';
}
