import type { PullRequestDetail } from '../../github/types';
import { CommentComposer } from './CommentComposer';
import { ReviewThreadView } from './ReviewThreadView';
import { TimelineEntries } from './TimelineEntries';
import { useThreadActions } from './useThreadActions';

interface DiscussionSectionProps {
  projectPath: string;
  detail: PullRequestDetail;
}

/**
 * Timeline, unresolved threads, and the box for a top-level comment. Anchored
 * threads also render against their line further down; unresolved ones are
 * repeated here so they can be found without hunting for the hunk.
 */
export function DiscussionSection({ projectPath, detail }: DiscussionSectionProps) {
  const unresolved = detail.threads.filter((t) => !t.isResolved);
  const { replyToThread, toggleResolved } = useThreadActions(projectPath, detail.number);

  const entries = detail.timeline.length + unresolved.length;

  return (
    <div className="w-full max-w-3xl mx-auto px-8 py-7 flex flex-col gap-6">
      {unresolved.length > 0 && (
        <section className="flex flex-col gap-6">
          <h2 className="text-[19px] font-medium text-text-primary pb-2.5 border-b border-ink/[0.08]">
            Unresolved
            <span className="ml-2 text-[15px] text-text-tertiary">{unresolved.length}</span>
          </h2>
          {unresolved.map((thread) => (
            <ReviewThreadView
              key={thread.id}
              thread={thread}
              onReply={replyToThread}
              onToggleResolved={toggleResolved}
            />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-5">
        {detail.timeline.length > 0 && (
          <h2 className="text-[19px] font-medium text-text-primary pb-2.5 border-b border-ink/[0.08]">Timeline</h2>
        )}
        <TimelineEntries
          items={detail.timeline}
          empty={entries === 0 ? 'Nothing has been said about this change' : undefined}
        />
      </section>

      <CommentComposer projectPath={projectPath} number={detail.number} subject="pr" />
    </div>
  );
}
