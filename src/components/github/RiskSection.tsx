import { useMemo } from 'react';
import type { PullRequestDetail } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { usePullRequestSignals } from '../../hooks/usePullRequestSignals';
import { describeFrequency, describePartner, mainAuthorOf } from '../../analysis/advice';
import type { DiffSignals } from '../../analysis/types';
import { Icon } from '../terminal/Icon';
import { Section } from './Sections';

interface RiskRow {
  key: string;
  path: string;
  kind: 'hotspot' | 'uncoupled';
  text: string;
}

const RISK_ICON: Record<RiskRow['kind'], string> = {
  hotspot: 'flame',
  uncoupled: 'git-fork',
};

function riskRows(signals: DiffSignals): RiskRow[] {
  const hotspots: RiskRow[] = [];
  const uncoupled: RiskRow[] = [];
  for (const [path, { signal, missing }] of Object.entries(signals)) {
    if (signal.tier === 'hot') {
      const author = mainAuthorOf(signal);
      const frequency = describeFrequency(signal);
      hotspots.push({
        key: path,
        path,
        kind: 'hotspot',
        text: author ? `${frequency} · most edits by ${author}` : frequency,
      });
    }
    for (const partner of missing) {
      uncoupled.push({
        key: `${path}\u0000${partner.path}`,
        path,
        kind: 'uncoupled',
        text: `${describePartner(partner.path)} — not in this pull request`,
      });
    }
  }
  return [...hotspots, ...uncoupled];
}

/** Hotspot files this pull request touches, and coupled files it leaves out. */
export function RiskSection({ detail }: { detail: PullRequestDetail }) {
  const files = useGithubStore((s) => s.files);
  const signals = usePullRequestSignals(detail.headSha, files);
  const rows = useMemo(() => (signals ? riskRows(signals) : []), [signals]);
  if (rows.length === 0) return null;

  return (
    <Section label="Risk" count={rows.length}>
      <div className="py-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2.5 px-4 py-1">
            <Icon name={RISK_ICON[row.kind]} className="w-3.5 h-3.5 shrink-0 text-git/80" />
            <span className="shrink-0 font-mono text-[12px] text-text-secondary">{row.path}</span>
            <span className="min-w-0 truncate font-mono text-[10px] text-text-tertiary">{row.text}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
