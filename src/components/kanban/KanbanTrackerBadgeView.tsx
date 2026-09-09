import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../terminal/Icon';

export interface KanbanTrackerBadgeViewProps {
  /** The tracker's mark: GitHub's logo, or a Linear issue's leading glyph. */
  icon: string;
  title: string;
  children: ReactNode;
  /** Opens the item in the panel; without it the badge is inert. */
  onClick?: () => void;
}

/**
 * A linked pull request or issue on a kanban card, matching
 * {@link KanbanBadgeView}'s geometry so a card carrying both reads as one row.
 *
 * Uncoloured: the card knows the number and nothing else, so any state colour
 * would claim something it has never read.
 */
export function KanbanTrackerBadgeView({ icon, title, children, onClick }: KanbanTrackerBadgeViewProps) {
  const style: CSSProperties = {
    color: 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
    background: 'color-mix(in srgb, var(--color-ink) 6%, transparent)',
  };

  return (
    <span
      className={`inline-flex items-center gap-0.5 shrink-0 font-mono text-[11px] leading-none px-2 py-1 rounded-full whitespace-nowrap ${
        onClick ? 'cursor-pointer hover:brightness-110 [-webkit-app-region:no-drag]' : ''
      }`}
      style={style}
      title={title}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <Icon name={icon} className="w-3 h-3" />
      {children}
    </span>
  );
}
