import { useMemo } from 'react';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import { DiffFileTree } from '../diff/DiffFileTree';
import { useGithubStore } from '../../stores/githubStore';
import { Icon } from '../terminal/Icon';

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
    if (!count) return done;
    return (
      <>
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
