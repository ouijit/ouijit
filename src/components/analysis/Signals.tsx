import type { LeverId } from '../../analysis/advice';

/** The visual vocabulary the diff chip and the project panel both read from. */

/** What each rule of thumb is about, so a lever reads before it is read. */
export const LEVER_ICON: Record<LeverId, string> = {
  cooling: 'minus-circle',
  split: 'square-split-horizontal',
  flatten: 'tree-structure',
  churn: 'arrows-clockwise',
  held: 'user-circle',
  fragmented: 'circle-dashed',
  seam: 'git-fork',
};

/** Rank as a percentile: 1 is the top of the project, 0 the bottom. */
export function topPercent(rank: number): string {
  return `top ${Math.max(1, Math.round((1 - rank) * 100))}%`;
}

/** One bar per month; quiet months keep a stub so the timeline stays whole. */
export function Sparkline({ monthly, className = 'mt-1.5 h-6' }: { monthly: number[]; className?: string }) {
  const max = Math.max(...monthly, 1);
  return (
    <div className={`flex items-end gap-[2px] ${className}`} aria-hidden>
      {monthly.map((n, i) => (
        <span
          key={i}
          className={`flex-1 rounded-[1px] ${n > 0 ? 'bg-git/75' : 'bg-ink/15'}`}
          style={{ height: barHeight(n, max) }}
        />
      ))}
    </div>
  );
}

/** A stub rather than nothing for a quiet month, and a floor so one is legible. */
export function barHeight(n: number, max: number): string {
  return n > 0 ? `${Math.max(MIN_BAR_PERCENT, (n / max) * 100)}%` : '2px';
}

const MIN_BAR_PERCENT = 10;

/** A 0..1 value as a filled track. */
export function Track({
  value,
  className,
  trackClassName = 'bg-ink/10',
  fillClassName = 'bg-git/80',
}: {
  value: number;
  className: string;
  trackClassName?: string;
  fillClassName?: string;
}) {
  return (
    <span className={`rounded-full overflow-hidden ${trackClassName} ${className}`} aria-hidden>
      <span className={`block h-full rounded-full ${fillClassName}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

/** A percentile as a filled track — the two of these are the hotspot score. */
export function MeterRow({ label, rank }: { label: string; rank: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[100px] shrink-0 text-[10px] text-text-tertiary">{label}</span>
      <Track value={rank} className="flex-1 h-1" trackClassName="bg-git-light" fillClassName="bg-git" />
      <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-text-secondary">{topPercent(rank)}</span>
    </div>
  );
}

/**
 * People, not a third measure: neutral steps ordered by share, so the two
 * scored hues stay the only colors carrying a number. The legend swatch is
 * what ties a name to its segment — order alone would make the reader count.
 */
const OWNER_SEGMENT = ['bg-ink/70', 'bg-ink/40', 'bg-ink/22'];
const OWNER_REST = 'bg-ink/12';
/** Below this the remainder is a rounding artefact rather than other people. */
const OWNER_REST_MIN = 0.02;

export function OwnershipBar({ topAuthors }: { topAuthors: Array<{ name: string; share: number }> }) {
  const rest = Math.max(0, 1 - topAuthors.reduce((sum, a) => sum + a.share, 0));
  return (
    <div>
      <div className="flex gap-[2px] h-1.5" aria-hidden>
        {topAuthors.map((author, i) => (
          <span
            key={author.name}
            className={`rounded-full ${OWNER_SEGMENT[i]}`}
            style={{ width: `${author.share * 100}%` }}
          />
        ))}
        {rest > OWNER_REST_MIN && <span className={`rounded-full ${OWNER_REST}`} style={{ width: `${rest * 100}%` }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
        {topAuthors.map((author, i) => (
          <span key={author.name} className="flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${OWNER_SEGMENT[i]}`} />
            <span className="truncate">{author.name}</span>
            <span className="tabular-nums">{Math.round(author.share * 100)}%</span>
          </span>
        ))}
        {rest > OWNER_REST_MIN && (
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${OWNER_REST}`} />
            others
          </span>
        )}
      </div>
    </div>
  );
}
