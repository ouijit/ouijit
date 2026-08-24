import { memo } from 'react';
import type { DiffSignals, FileSignal } from '../../analysis/types';
import { ANALYSIS_WINDOW_MONTHS } from '../../analysis/types';
import { describeComplexity, leversFor } from '../../analysis/advice';
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
 * for a file whose usual companion is absent. The evidence lives in the
 * tooltip; most files show nothing at all.
 */
export const AnalysisChip = memo(function AnalysisChip({ signal, missing }: { signal: FileSignal; missing: string[] }) {
  if (signal.tier === 'quiet' && missing.length === 0) return null;

  const levers = leversFor(signal);
  const detail = (
    <div className="w-60 whitespace-normal py-1 flex flex-col gap-3 font-normal">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-text-primary">
            {signal.commits} {signal.commits === 1 ? 'commit' : 'commits'}
          </span>
          <span className="text-[10px] text-text-tertiary">last {ANALYSIS_WINDOW_MONTHS} months</span>
        </div>
        <Sparkline monthly={signal.monthly} />
      </div>

      <div className="flex flex-col gap-1.5">
        <MeterRow label="Change frequency" rank={signal.freqRank} />
        {signal.cxRank != null && <MeterRow label="Nesting" rank={signal.cxRank} />}
        {signal.complexity && (
          <div className="text-[10px] text-text-tertiary">{describeComplexity(signal.complexity)}</div>
        )}
      </div>

      {signal.topAuthors.length > 0 && <OwnershipBar topAuthors={signal.topAuthors} />}

      {missing.length > 0 && (
        <div className="flex flex-col gap-1">
          {missing.map((partner) => (
            <span key={partner} className="text-[11px] leading-snug text-text-secondary">
              Usually changes with <span className="font-mono text-[10px]">{partner}</span> — not in this diff
            </span>
          ))}
        </div>
      )}

      {levers.length > 0 && (
        <div className="pt-2 border-t border-ink/10 flex flex-col gap-1">
          {levers.map((lever) => (
            <span key={lever.id} className="text-[11px] leading-snug text-text-secondary">
              {lever.text}
            </span>
          ))}
        </div>
      )}
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

/** One bar per month; quiet months keep a stub so the timeline stays whole. */
export function Sparkline({ monthly, className = 'mt-1.5 h-6' }: { monthly: number[]; className?: string }) {
  const max = Math.max(...monthly, 1);
  return (
    <div className={`flex items-end gap-[2px] ${className}`} aria-hidden>
      {monthly.map((n, i) => (
        <span
          key={i}
          className={`flex-1 rounded-[1px] ${n > 0 ? 'bg-git/75' : 'bg-ink/15'}`}
          style={{ height: n > 0 ? `${Math.max(12, (n / max) * 100)}%` : '2px' }}
        />
      ))}
    </div>
  );
}

/** A percentile as a filled track — the two of these are the hotspot score. */
export function MeterRow({ label, rank }: { label: string; rank: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[100px] shrink-0 text-[10px] text-text-tertiary">{label}</span>
      <span className="flex-1 h-1 rounded-full bg-ink/10 overflow-hidden">
        <span className="block h-full rounded-full bg-git/80" style={{ width: `${Math.round(rank * 100)}%` }} />
      </span>
      <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-text-secondary">
        top {Math.max(1, Math.round((1 - rank) * 100))}%
      </span>
    </div>
  );
}

/** Identity is carried by the ordered caption; color only separates segments. */
export function OwnershipBar({ topAuthors }: { topAuthors: Array<{ name: string; share: number }> }) {
  const SEGMENT = ['bg-git/90', 'bg-git/55', 'bg-git/30'];
  const rest = Math.max(0, 1 - topAuthors.reduce((sum, a) => sum + a.share, 0));
  return (
    <div>
      <div className="flex gap-[2px] h-1.5" aria-hidden>
        {topAuthors.map((author, i) => (
          <span
            key={author.name}
            className={`rounded-full ${SEGMENT[i]}`}
            style={{ width: `${author.share * 100}%` }}
          />
        ))}
        {rest > 0.02 && <span className="rounded-full bg-ink/15" style={{ width: `${rest * 100}%` }} />}
      </div>
      <div className="mt-1 text-[10px] text-text-tertiary truncate">
        {topAuthors.map((author) => `${author.name} ${Math.round(author.share * 100)}%`).join(' · ')}
        {rest > 0.02 ? ' · others' : ''}
      </div>
    </div>
  );
}

/** Rail counterpart: a dot on hot files, so the tree shows the diff's shape. */
export function AnalysisRailDot({ signal }: { signal: FileSignal | undefined }) {
  if (signal?.tier !== 'hot') return null;
  return <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-git/80" title="Hotspot" />;
}
