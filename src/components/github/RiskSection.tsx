import { useMemo } from 'react';
import type { PullRequestDetail } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { usePullRequestSignals } from '../../hooks/usePullRequestSignals';
import { describeFrequency, mainAuthorOf } from '../../analysis/advice';
import { analysisByPath } from '../../analysis/signals';
import type { DiffSignals } from '../../analysis/types';
import { Icon } from '../terminal/Icon';
import { Section } from './Sections';

interface RiskRow {
  key: string;
  path: string;
  icon: string;
  text: string;
}

function riskRows(signals: DiffSignals, paths: readonly string[]): RiskRow[] {
  const byPath = analysisByPath(signals, paths);
  const hot: RiskRow[] = [];
  const uncoupled: RiskRow[] = [];
  for (const [path, { signal, missing }] of byPath) {
    if (signal.tier === 'hot') {
      const author = mainAuthorOf(signal);
      hot.push({
        key: path,
        path,
        icon: 'flame',
        text: author ? `${describeFrequency(signal)} · most edits by ${author}` : describeFrequency(signal),
      });
    }
    for (const partner of missing) {
      uncoupled.push({
        key: `${path}\u0000${partner}`,
        path,
        icon: 'git-fork',
        text: `usually changes with ${partner} — not in this pull request`,
      });
    }
  }
  return [...hot, ...uncoupled];
}

/**
 * What this pull request's history says about it: hotspot files it touches,
 * and coupled files it leaves out. Facts only — absent entirely when the
 * analysis flag is off or the history is unremarkable.
 */
export function RiskSection({ detail }: { detail: PullRequestDetail }) {
  const files = useGithubStore((s) => s.files);
  const signals = usePullRequestSignals(detail.headSha, files);
  const paths = useMemo(() => files.map((f) => f.path), [files]);

  const rows = useMemo(() => (signals ? riskRows(signals, paths) : []), [signals, paths]);
  if (rows.length === 0) return null;

  return (
    <Section label="Risk" count={rows.length}>
      <div className="py-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2.5 px-4 py-1">
            <Icon name={row.icon} className="w-3.5 h-3.5 shrink-0 text-git/80" />
            <span className="shrink-0 font-mono text-[12px] text-text-secondary">{row.path}</span>
            <span className="min-w-0 truncate font-mono text-[10px] text-text-tertiary">{row.text}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
