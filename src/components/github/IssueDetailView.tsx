import { useEffect, useRef, useState } from 'react';
import type { IssueDetail } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore } from '../../stores/githubStore';
import { Avatar } from './Avatar';
import { CommentComposer } from './CommentComposer';
import { DetailChrome } from './DetailChrome';
import { Markdown } from './Markdown';
import { Dot, Fact, LabelChips, Section, TaskFact } from './Sections';
import { Tab, TabBar } from './Tabs';
import { TimelineEntries } from './TimelineEntries';
import { since } from './prFormat';

interface IssueDetailViewProps {
  projectPath: string;
  issue: IssueDetail;
  linkedTask?: TaskWithWorkspace;
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: () => void;
}

type Pane = 'summary' | 'timeline';

/**
 * One issue, in the same chrome a pull request gets.
 *
 * An issue has no code, so it has no third pane and no file rail — everything
 * else is the pull request view: what it says, who is on it, what has been said
 * about it, and the way into the work tracking it.
 */
export function IssueDetailView({
  projectPath,
  issue,
  linkedTask,
  openTaskLabel,
  onOpenTask,
  onCreateTask,
}: IssueDetailViewProps) {
  const loading = useGithubStore((s) => s.issueLoading);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Pane>('summary');

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [pane]);

  const comments = issue.timeline.filter((i) => i.kind !== 'event');
  const open = issue.state === 'open';

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <DetailChrome
        icon={open ? 'circle-dashed' : 'check-circle'}
        tone={open ? 'text-vcs-added' : 'text-vcs-renamed'}
        title={issue.title}
        url={issue.url}
        busy={loading}
        onRefresh={() => void useGithubStore.getState().reloadIssue(projectPath)}
        onClose={() => useGithubStore.getState().closeDetail()}
        tabs={
          <TabBar className="mx-auto shrink-0 self-stretch items-center">
            <Tab active={pane === 'summary'} onClick={() => setPane('summary')}>
              Summary
            </Tab>
            <Tab active={pane === 'timeline'} count={issue.timeline.length} onClick={() => setPane('timeline')}>
              Timeline
            </Tab>
          </TabBar>
        }
      />

      <div ref={paneRef} className="flex-1 min-w-0 overflow-y-auto">
        {pane === 'summary' ? (
          <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-7">
            <header className="flex flex-col gap-3">
              <h1 className="text-[28px] leading-tight font-medium text-text-primary text-balance">{issue.title}</h1>
              <div className="flex items-center gap-2 text-[15px] text-text-secondary">
                <Avatar login={issue.author} url={issue.authorAvatarUrl} size={22} />
                <span className="text-text-primary">{issue.author}</span>
                <Dot />
                <span>opened {since(issue.createdAt)}</span>
                <Dot />
                <span>#{issue.number}</span>
                <Dot />
                <span>{stateLabel(issue)}</span>
              </div>
            </header>

            <dl className="flex flex-col gap-2.5">
              <TaskFact
                task={linkedTask}
                openTaskLabel={openTaskLabel}
                onOpenTask={onOpenTask}
                createLabel="Create task"
                createTitle="Create a task from this issue"
                onCreate={onCreateTask}
              />

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
            </dl>

            <Section label="Description" defaultOpen>
              {issue.body.trim() ? (
                <Markdown body={issue.body} />
              ) : (
                <p className="text-[15px] text-text-tertiary">No description was written</p>
              )}
            </Section>

            <Section label="Comments" count={comments.length} defaultOpen>
              <div className="flex flex-col gap-5">
                <TimelineEntries items={comments} empty="No comments yet" />
                <CommentComposer projectPath={projectPath} number={issue.number} subject="issue" />
              </div>
            </Section>
          </div>
        ) : (
          <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-6">
            <section className="flex flex-col gap-5">
              {issue.timeline.length > 0 && (
                <h2 className="text-[19px] font-medium text-text-primary pb-2.5 border-b border-ink/[0.08]">
                  Timeline
                </h2>
              )}
              <TimelineEntries items={issue.timeline} empty="Nothing has been said about this issue" />
            </section>
            <CommentComposer projectPath={projectPath} number={issue.number} subject="issue" />
          </div>
        )}
      </div>
    </div>
  );
}

function stateLabel(issue: IssueDetail): string {
  if (issue.state === 'open') return 'Open';
  return issue.stateReason === 'NOT_PLANNED' ? 'Closed as not planned' : 'Closed';
}
