import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TimelineItem } from '../../issues/types';
import type { TaskWithWorkspace } from '../../types';
import { Avatar } from './Avatar';
import { DetailChrome } from './DetailChrome';
import { Markdown } from './Markdown';
import { Dot, Section, TaskFact } from './Sections';
import { Tab, TabBar } from './Tabs';
import { TimelineEntries } from './TimelineEntries';
import { since } from './since';

interface IssueDetailViewProps {
  title: string;
  /** `#299` or `ENG-231`: what the row printed, printed again here. */
  identifier: string;
  url: string;
  /** Leading glyph and its tint, so a closed issue does not read as an open one. */
  icon: string;
  tone: string;
  stateLabel: string;
  author: string;
  authorAvatarUrl?: string;
  createdAt: string;
  body: string;
  timeline: TimelineItem[];
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
  /** Controls in the chrome — Linear's state control, and nothing on GitHub's side. */
  actions?: ReactNode;
  /** Facts below the linked task, whichever ones this source has. */
  facts?: ReactNode;
  /** The comment box, which knows where its comments go. */
  composer: ReactNode;
  /** Unsent comments waiting on a person, rendered above the composer. */
  drafts?: ReactNode;
  linkedTask?: TaskWithWorkspace;
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onCreateTask: () => void;
}

type Pane = 'summary' | 'timeline';

/**
 * One issue, in the same chrome a pull request gets, minus the code pane and
 * file rail. The facts are the caller's: a GitHub issue has no priority, cycle
 * or estimate, and those rows are absent rather than empty.
 */
export function IssueDetailView({
  title,
  identifier,
  url,
  icon,
  tone,
  stateLabel,
  author,
  authorAvatarUrl,
  createdAt,
  body,
  timeline,
  loading,
  onRefresh,
  onClose,
  actions,
  facts,
  composer,
  drafts,
  linkedTask,
  openTaskLabel,
  onOpenTask,
  onCreateTask,
}: IssueDetailViewProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Pane>('summary');

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [pane]);

  const comments = timeline.filter((i) => i.kind !== 'event');

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <DetailChrome
        icon={icon}
        tone={tone}
        title={title}
        url={url}
        busy={loading}
        actions={actions}
        onRefresh={onRefresh}
        onClose={onClose}
        tabs={
          <TabBar className="mx-auto shrink-0 self-stretch items-center">
            <Tab active={pane === 'summary'} onClick={() => setPane('summary')}>
              Summary
            </Tab>
            <Tab active={pane === 'timeline'} count={timeline.length} onClick={() => setPane('timeline')}>
              Timeline
            </Tab>
          </TabBar>
        }
      />

      <div ref={paneRef} className="flex-1 min-w-0 overflow-y-auto">
        {pane === 'summary' ? (
          <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-7">
            <header className="flex flex-col gap-3">
              <h1 className="text-[28px] leading-tight font-medium text-text-primary text-balance">{title}</h1>
              <div className="flex items-center gap-2 text-[15px] text-text-secondary">
                <Avatar login={author} url={authorAvatarUrl} size={22} />
                <span className="text-text-primary">{author}</span>
                <Dot />
                <span>opened {since(createdAt)}</span>
                <Dot />
                <span>{identifier}</span>
                <Dot />
                <span>{stateLabel}</span>
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
              {facts}
            </dl>

            <Section label="Description" defaultOpen>
              {body.trim() ? (
                <Markdown body={body} />
              ) : (
                <p className="text-[15px] text-text-tertiary">No description was written</p>
              )}
            </Section>

            <Section label="Comments" count={comments.length} defaultOpen>
              <div className="flex flex-col gap-5">
                <TimelineEntries items={comments} empty="No comments yet" />
                {drafts}
                {composer}
              </div>
            </Section>
          </div>
        ) : (
          <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-6">
            <section className="flex flex-col gap-5">
              {timeline.length > 0 && (
                <h2 className="text-[19px] font-medium text-text-primary pb-2.5 border-b border-ink/[0.08]">
                  Timeline
                </h2>
              )}
              <TimelineEntries items={timeline} empty="Nothing has been said about this issue" />
            </section>
            {drafts}
            {composer}
          </div>
        )}
      </div>
    </div>
  );
}
