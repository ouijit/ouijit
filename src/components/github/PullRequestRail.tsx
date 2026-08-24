import { useMemo } from 'react';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import { DiffFileTree } from '../diff/DiffFileTree';
import { useGithubStore } from '../../stores/githubStore';
import { Icon } from '../terminal/Icon';
import { diffShape } from '../../diffSource';
import { useAnalysisSignals } from '../../hooks/useAnalysisSignals';
import { AnalysisRailDot } from '../diff/AnalysisChip';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  /** Takes the document to a file, or with no path back to the top. */
  onSelect: (path: string | null) => void;
  width: number;
}

export function PullRequestRail({ detail, files, onSelect, width }: PullRequestRailProps) {
  const viewedPaths = useGithubStore((s) => s.viewedPaths);
  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);
  const activePath = useGithubStore((s) => s.activePath);

  // The same key FilesSection loads under, so the store answers both from one fetch.
  const projectPath = useGithubStore((s) => s.projectPath);
  const fingerprint = useMemo(() => `${detail.headSha}\n${diffShape(files)}`, [files, detail.headSha]);
  const signals = useAnalysisSignals(
    projectPath ?? '',
    fingerprint,
    files.map((f) => f.path),
  );

  const unresolvedByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of detail.threads) {
      if (thread.isResolved) continue;
      counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
    }
    return counts;
  }, [detail.threads]);

  const trailing = (path: string) => {
    const count = unresolvedByPath.get(path);
    // Viewed state shows here too, so review progress is readable without
    // scrolling the document.
    const done = viewed.has(path) ? <Icon name="check" className="shrink-0 w-3 h-3 text-accent/70" /> : null;
    const dot = <AnalysisRailDot signal={signals?.files[path]} />;
    if (!count)
      return (
        <>
          {dot}
          {done}
        </>
      );
    return (
      <>
        {dot}
        <span className="shrink-0 font-mono text-[10px] text-accent" title="Unresolved threads">
          {count}
        </span>
        {done}
      </>
    );
  };

  return (
    // No right border: the seam beside this is the boundary.
    <div className="shrink-0 flex flex-col overflow-hidden" style={{ width }}>
      <DiffFileTree
        files={files}
        activePath={activePath}
        onFileClick={onSelect}
        renderFileTrailing={(file) => trailing(file.path)}
      />
    </div>
  );
}
