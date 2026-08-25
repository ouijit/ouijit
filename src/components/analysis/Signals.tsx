import type { LeverId } from '../../analysis/advice';
import type { HotspotTier } from '../../analysis/types';

/** The visual vocabulary the diff chip and the project panel both read from. */

/**
 * How hot a file runs, as a colour. `chip` tints a filled badge, `glyph` a
 * bare icon — the same distinction the pull request state badges draw.
 */
export const TIER_COLOR: Record<HotspotTier, { chip: string; glyph: string }> = {
  hot: { chip: 'bg-git-light text-git', glyph: 'text-git' },
  warm: { chip: 'text-git/50', glyph: 'text-git/50' },
  quiet: { chip: 'text-ink/45', glyph: 'text-ink/25' },
};

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
function topPercent(rank: number): string {
  return `top ${Math.max(1, Math.round((1 - rank) * 100))}%`;
}

/**
 * One bar per month, scaled to the busiest. A quiet month keeps a stub rather
 * than vanishing, so the timeline reads as a whole span either way.
 */
export function BarSeries({
  monthly,
  className,
  barClassName,
  title,
}: {
  monthly: number[];
  className: string;
  barClassName: (n: number, i: number) => string;
  title?: (n: number, i: number) => string;
}) {
  const max = Math.max(...monthly, 1);
  return (
    <div className={`flex items-end gap-[2px] ${className}`} aria-hidden>
      {monthly.map((n, i) => (
        <span
          key={i}
          title={title?.(n, i)}
          className={barClassName(n, i)}
          style={{ height: n > 0 ? `${Math.max(MIN_BAR_PERCENT, (n / max) * 100)}%` : '2px' }}
        />
      ))}
    </div>
  );
}

const MIN_BAR_PERCENT = 10;

export function Sparkline({ monthly, className = 'mt-1.5 h-6' }: { monthly: number[]; className?: string }) {
  return (
    <BarSeries
      monthly={monthly}
      className={className}
      barClassName={(n) => `flex-1 rounded-[1px] ${n > 0 ? 'bg-git/75' : 'bg-ink/15'}`}
    />
  );
}

/** A 0..1 value as a filled track. */
export function Track({ value, className }: { value: number; className: string }) {
  return (
    <span className={`rounded-full overflow-hidden bg-ink/10 ${className}`} aria-hidden>
      <span className="block h-full rounded-full bg-git/80" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

/**
 * A percentile as a filled track, in the scored hue rather than the neutral
 * one `Track` uses — the two of these are the hotspot score.
 */
function ScoreTrack({ rank, className }: { rank: number; className: string }) {
  return (
    <span className={`block rounded-full overflow-hidden bg-git-light ${className}`} aria-hidden>
      <span className="block h-full rounded-full bg-git" style={{ width: `${Math.round(rank * 100)}%` }} />
    </span>
  );
}

/** Compact enough for a tooltip: label, track and percentile on one line. */
export function MeterRow({ label, rank }: { label: string; rank: number }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-[100px] shrink-0 text-text-tertiary">{label}</span>
      <ScoreTrack rank={rank} className="flex-1 h-1" />
      <span className="w-10 shrink-0 text-right tabular-nums text-text-secondary">{topPercent(rank)}</span>
    </div>
  );
}

/** The same, stacked, over the measurement the percentile is read from. */
export function ScoreMeter({ label, rank, detail }: { label: string; rank: number; detail: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-text-secondary">{label}</span>
        <span className="tabular-nums text-text-primary">{topPercent(rank)}</span>
      </div>
      <ScoreTrack rank={rank} className="mt-1.5 h-[5px]" />
      <p className="mt-1.5 text-[10px] text-text-tertiary">{detail}</p>
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
