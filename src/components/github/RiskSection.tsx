import { useMemo } from 'react';
import type { PullRequestDetail } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { diffShape } from '../../diffSource';
import { useAnalysisSignals } from '../../hooks/useAnalysisSignals';
import { missingPartners } from '../diff/AnalysisChip';
import { ANALYSIS_WINDOW_MONTHS, type DiffSignals, type FileSignal } from '../../analysis/types';
import { Icon } from '../terminal/Icon';
import { Section } from './Sections';

interface RiskRow {
  path: string;
  icon: string;
  text: string;
}

function riskRows(signals: DiffSignals, paths: readonly string[]): RiskRow[] {
  const present = new Set(paths);
  const rows: RiskRow[] = [];
  for (const path of paths) {
    const signal = signals.files[path];
    if (signal?.tier === 'hot') rows.push({ path, icon: 'flame', text: hotText(signal) });
  }
  for (const path of paths) {
    for (const partner of missingPartners(signals, path, present)) {
      rows.push({ path, icon: 'git-fork', text: `usually changes with ${partner} — not in this pull request` });
    }
  }
  return rows;
}

function hotText(signal: FileSignal): string {
  const commits = `${signal.commits} commits in the last ${ANALYSIS_WINDOW_MONTHS} months`;
  const main = signal.topAuthors[0];
  return main && main.share >= 0.5 ? `${commits} · most edits by ${main.name}` : commits;
}

/**
 * What this pull request's history says about it: hotspot files it touches,
 * and coupled files it leaves out. Facts only — absent entirely when the
 * analysis flag is off or the history is unremarkable.
 */
export function RiskSection({ projectPath, detail }: { projectPath: string; detail: PullRequestDetail }) {
  const files = useGithubStore((s) => s.files);
  const fingerprint = useMemo(() => `${detail.headSha}\n${diffShape(files)}`, [files, detail.headSha]);
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const signals = useAnalysisSignals(projectPath, fingerprint, paths);

  const rows = useMemo(() => (signals ? riskRows(signals, paths) : []), [signals, paths]);
  if (rows.length === 0) return null;

  return (
    <Section label="Risk" count={rows.length}>
      <div className="py-2">
        {rows.map((row, i) => (
          <div key={`${row.path}-${i}`} className="flex items-center gap-2.5 px-4 py-1">
            <Icon name={row.icon} className="w-3.5 h-3.5 shrink-0 text-git/80" />
            <span className="shrink-0 font-mono text-[12px] text-text-secondary">{row.path}</span>
            <span className="min-w-0 truncate font-mono text-[10px] text-text-tertiary">{row.text}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
