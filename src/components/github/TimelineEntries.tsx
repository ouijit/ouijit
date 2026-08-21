import type { TimelineItem } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { Avatar } from './Avatar';
import { CommentActions } from './CommentActions';
import { Markdown } from './Markdown';
import { reviewStateLabel, since } from './prFormat';

/**
 * Timeline entries. A section that shows a count must render through this, or
 * the count and the list disagree.
 */
export function TimelineEntries({ items, empty }: { items: TimelineItem[]; empty?: string }) {
  if (items.length === 0) {
    return empty ? <p className="text-[15px] text-text-tertiary">{empty}</p> : null;
  }

  return (
    <div className="flex flex-col gap-5">
      {items.map((item) =>
        item.kind === 'event' ? (
          <div key={item.id} className="flex items-center gap-2 text-[13px] text-text-tertiary">
            <Icon name="git-commit" className="w-4 h-4 shrink-0 opacity-60" />
            <Avatar login={item.author} url={item.authorAvatarUrl} size={16} />
            <span className="text-text-secondary">{item.author}</span>
            <span>{item.eventType}</span>
            <span className="opacity-50">·</span>
            <span>{since(item.createdAt)}</span>
          </div>
        ) : (
          <article key={item.id} className="group/comment flex gap-3">
            <Avatar login={item.author} url={item.authorAvatarUrl} size={26} className="mt-0.5" />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
                <span className="text-text-primary text-[15px]">{item.author}</span>
                <span>{item.kind === 'review' ? reviewStateLabel(item.reviewState) : 'commented'}</span>
                <span className="opacity-50">·</span>
                <span className="flex-1 min-w-0 truncate">{since(item.createdAt)}</span>
                {/* A submitted review cannot be deleted through the API — only
                    dismissed — so only a comment offers it. */}
                <CommentActions
                  url={item.url}
                  deletable={
                    item.kind === 'comment' && item.viewerCanDelete && item.databaseId != null
                      ? { kind: 'issue', commentId: item.databaseId }
                      : undefined
                  }
                />
              </div>
              {item.body.trim() && <Markdown body={item.body} />}
            </div>
          </article>
        ),
      )}
    </div>
  );
}
