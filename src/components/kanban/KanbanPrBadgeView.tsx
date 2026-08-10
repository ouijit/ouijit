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
 * a card carrying both reads as one row of chips rather than two competing
 * badge languages.
 *
 * Wears GitHub's mark rather than a git glyph, because that is what it means: a
 * branch is a git thing and every card has one, while this is a pull request on
 * a service, opened by pressing it.
 *
 * Uncoloured, and deliberately. A card knows a pull request's number and
 * nothing else — not whether it is open, drafted, merged or closed — so any
 * colour it wore would be a claim about a state it has never read. Green said
 * "open" about pull requests that had been closed for a week. The mark is
 * monochrome anyway, which is the brand being honest about the same thing.
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
