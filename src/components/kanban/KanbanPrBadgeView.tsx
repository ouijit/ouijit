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
 */
export function KanbanPrBadgeView({ prNumber, onClick }: KanbanPrBadgeViewProps) {
  const style: CSSProperties = {
    color: 'color-mix(in srgb, var(--color-vcs-added) 80%, var(--color-ink))',
    background: 'color-mix(in srgb, var(--color-vcs-added) 12%, transparent)',
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
      <Icon name="git-pull-request" className="w-3 h-3" />
      <span className="opacity-50">#</span>
      {prNumber}
    </span>
  );
}
