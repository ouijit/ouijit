import type { CSSProperties } from 'react';
import { Icon } from '../terminal/Icon';

export interface KanbanPrBadgeViewProps {
  prNumber: number;
  /** Click opens the pull request in the panel. Omitted, the badge is inert. */
  onClick?: () => void;
}

/**
 * The linked pull request chip on a kanban card.
 *
 * Styled after {@link KanbanBadgeView} — same pill geometry and mono type — so
 * a card carrying both renders as one row of chips.
 *
 * Wears GitHub's mark rather than a git glyph: a branch is a git thing and
 * every card has one, while this is a pull request on a service.
 *
 * Uncoloured, because a card knows the number and nothing else — not whether
 * the pull request is open, drafted, merged or closed — so any colour would
 * claim a state it has never read.
 */
export function KanbanPrBadgeView({ prNumber, onClick }: KanbanPrBadgeViewProps) {
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
      title={`Pull request #${prNumber}`}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <Icon name="github-logo" className="w-3 h-3" />
      <span className="opacity-50">#</span>
      {prNumber}
    </span>
  );
}
