import type { LinearIssueDetail } from '../../linear/types';
import type { TaskWithWorkspace } from '../../types';
import { useLinearStore } from '../../stores/linearStore';
import { useProjectStore } from '../../stores/projectStore';
import { Avatar } from '../issues/Avatar';
import { CommentComposer } from '../issues/CommentComposer';
import { Fact, LabelChips } from '../issues/Sections';
import { IssueDetailView } from '../issues/IssueDetailView';
import { StateControl } from './StateControl';
import { stateGlyph } from './stateGlyph';
import { StagedComments } from './StagedComments';

interface LinearIssueViewProps {
  projectPath: string;
  issue: LinearIssueDetail;
  linkedTask?: TaskWithWorkspace;
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: () => void;
}

/** One Linear issue, in the shared detail view, with what Linear has and GitHub does not. */
export function LinearIssueView({
  projectPath,
  issue,
  linkedTask,
  openTaskLabel,
  onOpenTask,
  onCreateTask,
}: LinearIssueViewProps) {
  const loading = useLinearStore((s) => s.issueLoading);
  const drafts = useLinearStore((s) => s.drafts);

  const post = async (body: string) => {
    const result = await window.api.linear.comment(projectPath, issue.id, body);
    if (!result.success) {
      useProjectStore.getState().addToast(result.error ?? "Couldn't post the comment", 'error');
      return false;
    }
    await useLinearStore.getState().reloadIssue(projectPath);
    return true;
  };

  return (
    <IssueDetailView
      title={issue.title}
      identifier={issue.identifier}
      url={issue.url}
      icon={stateGlyph(issue.state.type)}
      iconColor={issue.state.color}
      stateLabel={issue.state.name}
      author={issue.creator?.displayName ?? 'Unknown'}
      authorAvatarUrl={issue.creator?.avatarUrl}
      createdAt={issue.createdAt}
      body={issue.description}
      timeline={issue.comments}
      loading={loading}
      onRefresh={() => void useLinearStore.getState().reloadIssue(projectPath)}
      onClose={() => useLinearStore.getState().closeDetail()}
      linkedTask={linkedTask}
      openTaskLabel={openTaskLabel}
      onOpenTask={onOpenTask}
      onCreateTask={onCreateTask}
      actions={<StateControl projectPath={projectPath} issue={issue} />}
      drafts={<StagedComments projectPath={projectPath} drafts={drafts} />}
      composer={
        <CommentComposer viewer={issue.viewer.displayName} viewerAvatarUrl={issue.viewer.avatarUrl} onPost={post} />
      }
      facts={
        <>
          <Fact icon="user-circle" label="Assignee">
            {issue.assignee ? (
              <span className="flex items-center gap-1.5 text-text-primary">
                <Avatar login={issue.assignee.displayName} url={issue.assignee.avatarUrl} size={18} />
                {issue.assignee.displayName}
              </span>
            ) : (
              <span className="text-text-tertiary">Nobody</span>
            )}
          </Fact>

          <Fact icon="flag" label="Priority">
            <span className={issue.priority === 0 ? 'text-text-tertiary' : 'text-text-primary'}>
              {issue.priorityLabel}
            </span>
          </Fact>

          {issue.cycle && (
            <Fact icon="repeat" label="Cycle">
              <span className="text-text-primary">{issue.cycle.name ?? `Cycle ${issue.cycle.number}`}</span>
            </Fact>
          )}

          {issue.estimate != null && (
            <Fact icon="ruler" label="Estimate">
              <span className="text-text-primary">{issue.estimate}</span>
            </Fact>
          )}

          <Fact icon="users-three" label="Team">
            <span className="text-text-primary">
              {issue.team.key} · {issue.team.name}
            </span>
          </Fact>

          <Fact icon="tag" label="Labels">
            {issue.labels.length === 0 ? (
              <span className="text-text-tertiary">None</span>
            ) : (
              <LabelChips labels={issue.labels} />
            )}
          </Fact>
        </>
      }
    />
  );
}
