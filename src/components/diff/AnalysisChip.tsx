import { memo } from 'react';
import type { DiffSignals, FileSignal } from '../../analysis/types';
import { ANALYSIS_WINDOW_MONTHS } from '../../analysis/types';
import { Tooltip } from '../ui/Tooltip';
import { Icon } from '../terminal/Icon';

/** Below this a pair changes together too loosely to be worth a warning. */
export const COUPLING_MIN_DEGREE = 0.5;

/** Coupled partners of `path` that the diff on screen does not contain. */
export function missingPartners(signals: DiffSignals, path: string, present: ReadonlySet<string>): string[] {
  return signals.couplings
    .filter((c) => c.path === path && c.degree >= COUPLING_MIN_DEGREE && !present.has(c.partner))
    .map((c) => c.partner);
}

/**
 * Per-file history signal for a diff header — a flame for a hotspot, a fork
 * for a file whose usual companion is absent. The numbers live in the
 * tooltip; most files show nothing at all.
 */
export const AnalysisChip = memo(function AnalysisChip({ signal, missing }: { signal: FileSignal; missing: string[] }) {
  if (signal.tier === 'quiet' && missing.length === 0) return null;

  const detail = (
    <div className="flex flex-col gap-0.5">
      <span>
        {signal.commits} {signal.commits === 1 ? 'commit' : 'commits'} in the last {ANALYSIS_WINDOW_MONTHS} months
      </span>
      {signal.mainAuthor && signal.ownership >= 0.5 && <span>Most edits by {signal.mainAuthor}</span>}
      {missing.map((partner) => (
        <span key={partner}>Usually changes with {partner} — not in this diff</span>
      ))}
    </div>
  );

  return (
    <Tooltip text={detail} referenceClassName="shrink-0 inline-flex">
      <span
        className={`flex items-center gap-1 text-[10px] px-1 py-px rounded font-medium ${
          signal.tier === 'hot' ? 'bg-git-light text-git' : 'text-ink/45'
        }`}
      >
        <Icon name={signal.tier === 'quiet' ? 'git-fork' : 'flame'} className="!w-3 !h-3" />
        {signal.tier === 'hot' && 'hotspot'}
      </span>
    </Tooltip>
  );
});

/** Rail counterpart: a dot on hot files, so the tree shows the diff's shape. */
export function AnalysisRailDot({ signal }: { signal: FileSignal | undefined }) {
  if (signal?.tier !== 'hot') return null;
  return <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-git/80" title="Hotspot" />;
}
