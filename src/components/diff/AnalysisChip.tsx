import { memo } from 'react';
import { ANALYSIS_WINDOW_MONTHS, type FileAnalysis, type HotspotTier } from '../../analysis/types';
import { PARTNER_PREFIX, count, describeNesting, leversFor } from '../../analysis/advice';
import { LEVER_ICON, MeterRow, OwnershipBar, Sparkline, TIER_COLOR } from '../analysis/Signals';
import { Tooltip } from '../ui/Tooltip';
import { Icon } from '../terminal/Icon';

export function worthAChip({ signal, missing }: FileAnalysis): boolean {
  return signal.tier !== 'quiet' || missing.length > 0;
}

export const AnalysisChip = memo(function AnalysisChip({ signal, missing }: FileAnalysis) {
  const levers = leversFor(signal);
  const detail = (
    <div className="w-60 whitespace-normal py-1 flex flex-col gap-3 font-normal">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-text-primary">{count(signal.commits, 'commit')}</span>
          <span className="text-[10px] text-text-tertiary">last {ANALYSIS_WINDOW_MONTHS} months</span>
        </div>
        <Sparkline monthly={signal.monthly} />
      </div>

      <div className="flex flex-col gap-1.5">
        <MeterRow label="Change frequency" rank={signal.freqRank} />
        {signal.cxRank != null && <MeterRow label="Nesting" rank={signal.cxRank} />}
        {signal.complexity && (
          <div className="text-[10px] text-text-tertiary">{describeNesting(signal.complexity)}</div>
        )}
      </div>

      {signal.topAuthors.length > 0 && <OwnershipBar topAuthors={signal.topAuthors} />}

      {missing.length > 0 && (
        <div className="flex flex-col gap-1">
          {missing.map((partner) => (
            <span key={partner} className="text-[11px] leading-snug text-text-secondary">
              {PARTNER_PREFIX} <span className="font-mono text-[10px]">{partner}</span> — not in this diff
            </span>
          ))}
        </div>
      )}

      {levers.length > 0 && (
        <div className="pt-2 border-t border-ink/10 flex flex-col gap-1">
          {levers.map((lever) => (
            <span key={lever.id} className="flex gap-1.5 text-[11px] leading-snug text-text-secondary">
              <Icon name={LEVER_ICON[lever.id]} className="w-3 h-3 shrink-0 mt-px text-ink/40" />
              {lever.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip text={detail} referenceClassName="shrink-0 inline-flex">
      <span className={`flex items-center gap-1 text-[10px] px-1 py-px rounded font-medium ${TIER_COLOR[signal.tier].chip}`}>
        <Icon name={signal.tier === 'quiet' ? 'git-fork' : 'flame'} className="!w-3 !h-3" />
        {signal.tier === 'hot' && 'hotspot'}
      </span>
    </Tooltip>
  );
});

export function AnalysisRailDot({ signal }: { signal: { tier: HotspotTier } | undefined }) {
  if (signal?.tier !== 'hot') return null;
  return <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-git/80" title="Hotspot" />;
}
