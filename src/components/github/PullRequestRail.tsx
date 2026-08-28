import { memo, useMemo } from 'react';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import type { LensSummary } from '../../lens/config';
import { DiffFileTree } from '../diff/DiffFileTree';
import { useGithubStore } from '../../stores/githubStore';
import { isSectionViewed } from '../../github/viewedSections';
import { Icon } from '../terminal/Icon';
import { usePullRequestSignals } from '../../hooks/usePullRequestSignals';
import { AnalysisRailDot } from '../diff/AnalysisChip';
import { LensPicker } from '../diff/LensPicker';
import { estimateLensPromptChars } from '../../lens/lensPrompt';
import type { LensSession } from '../diff/useLensSession';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  /** Takes the document to a file, or with no path back to the top. */
  onSelect: (path: string | null, group?: string) => void;
  /** This pull request's lens, the same session the document reads. */
  lens: LensSession;
  lenses: LensSummary[];
  onOpenLenses: () => void;
  /** The grouping has just arrived, so its parts lay themselves in. */
  revealing?: boolean;
  /** Set by dragging the seam beside this. */
  width: number;
}

/**
 * Memoised because the pane above it re-renders on every batch of diffs that
 * lands, and this draws a node per file and per directory of them.
 */
export const PullRequestRail = memo(function PullRequestRail({
  detail,
  files,
  onSelect,
  lens,
  lenses,
  onOpenLenses,
  revealing,
  width,
}: PullRequestRailProps) {
  const viewedPaths = useGithubStore((s) => s.viewedPaths);
  const viewedParts = useGithubStore((s) => s.viewedSections);
  const activeSection = useGithubStore((s) => s.activeSection);
  const collapsed = useGithubStore((s) => s.collapsedGroups);
  const setGroupCollapsed = useGithubStore((s) => s.setGroupCollapsed);
  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);

  const signals = usePullRequestSignals(detail.headSha, files);
  const promptChars = useMemo(() => estimateLensPromptChars(files), [files]);

  const unresolvedByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of detail.threads) {
      if (thread.isResolved) continue;
      counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
    }
    return counts;
  }, [detail.threads]);

  const trailing = (path: string, hunks?: number, section = path) => {
    const count = unresolvedByPath.get(path);
    // How much of a file a part of the change claims, when it is not all of it.
    const share =
      hunks && hunks > 1 ? (
        <span className="shrink-0 font-mono text-[10px] text-ink/35" title={`${hunks} hunks here`}>
          {hunks}
        </span>
      ) : null;
    return (
      <>
        <AnalysisRailDot signal={signals?.[path]?.signal} />
        {share}
        {count ? (
          <span className="shrink-0 font-mono text-[10px] text-accent" title="Unresolved threads">
            {count}
          </span>
        ) : null}
        {isSectionViewed(viewed, viewedParts, section, path) && (
          <Icon name="check" className="shrink-0 w-3 h-3 text-accent/70" />
        )}
      </>
    );
  };

  return (
    // No right border: the seam beside this is the boundary.
    <div className="shrink-0 flex flex-col overflow-hidden" style={{ width }}>
      {/* `h-9` is a file card's header, which is what this ledge meets across the
          seam — there is no toolbar over this pane. */}
      <div className="pane-ledge shrink-0 flex flex-col h-9">
        <LensPicker
          session={lens}
          lenses={lenses}
          changedFiles={detail.changedFiles}
          viewed={viewedPaths.length}
          promptChars={promptChars}
          onLensOn={(on) => {
            // Mode first: what the reader asked for must not depend on the
            // scroll succeeding.
            lens.setLensOn(on);
            onSelect(null);
          }}
          onManage={onOpenLenses}
        />
      </div>

      <DiffFileTree
        files={files}
        lens={{ groups: lens.shown, collapsed, onCollapsedChange: setGroupCollapsed }}
        onFileClick={onSelect}
        renderFileTrailing={(file, hunks, section) => trailing(file.path, hunks, section)}
        activeSection={activeSection}
        revealing={revealing}
      />
    </div>
  );
});
