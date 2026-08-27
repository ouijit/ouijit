import { useMemo } from 'react';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import type { ResolvedGroup } from '../../lens/lens';
import type { StoredLens } from '../../lens/readLens';
import type { LensSummary } from '../../lens/config';
import { DiffFileTree } from '../diff/DiffFileTree';
import { useGithubStore } from '../../stores/githubStore';
import { isSectionViewed } from '../../github/viewedSections';
import { Icon } from '../terminal/Icon';
import { usePullRequestSignals } from '../../hooks/usePullRequestSignals';
import { AnalysisRailDot } from '../diff/AnalysisChip';
import { LensPicker } from '../diff/LensPicker';
import { estimateLensPromptChars } from '../../lens/lensPrompt';
import type { LensRun } from '../diff/useLensSession';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  /** Takes the document to a file, or with no path back to the top. */
  onSelect: (path: string | null, group?: string) => void;
  /** The lens as bound to this diff, or null when none has been written. */
  groups: ResolvedGroup[] | null;
  /** The lens on file, exactly as it was read, for the picker to describe. */
  onFile: StoredLens | null;
  lensOn: boolean;
  onLensOn: (on: boolean) => void;
  /** The lenses the project keeps. */
  lenses: LensSummary[];
  /** Reads this pull request through one, which is an agent run. */
  onRunLens: (lens: LensSummary) => void;
  /** Opens the project's lenses to add or edit one. */
  onOpenLenses: () => void;
  /** The lens being written, if one is running. */
  lensWriting: LensRun | null;
  /** The grouping has just arrived, so its parts lay themselves in. */
  revealing?: boolean;
  /** Set by dragging the seam beside this. */
  width: number;
}

/**
 * The changed files, for the code pane only. With a lens on, the same rail lists
 * the parts of the change instead, and a file belonging to three parts appears
 * in all three.
 */
export function PullRequestRail({
  detail,
  files,
  onSelect,
  groups,
  onFile,
  lensOn,
  onLensOn,
  lenses,
  onRunLens,
  onOpenLenses,
  lensWriting,
  revealing,
  width,
}: PullRequestRailProps) {
  const viewedPaths = useGithubStore((s) => s.viewedPaths);
  const viewedSections = useGithubStore((s) => s.viewedSections);
  const activeSection = useGithubStore((s) => s.activeSection);
  const collapsedGroups = useGithubStore((s) => s.collapsedGroups);
  const collapsed = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);
  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);
  const viewedParts = useMemo(() => new Set(viewedSections), [viewedSections]);

  const signals = usePullRequestSignals(detail.headSha, files);
  // What a lens run would send, so the picker can say so before one is started.
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
      {/* `h-9` is a file card's header. This pane has no toolbar over it, so
          what the ledge meets across the seam is a header stuck to the top of
          the well. */}
      <div className="pane-ledge shrink-0 flex flex-col h-9">
        <LensPicker
          lenses={lenses}
          onFile={onFile}
          lensOn={lensOn}
          changedFiles={detail.changedFiles}
          viewed={viewedPaths.length}
          resolved={groups}
          promptChars={promptChars}
          writing={lensWriting}
          onAllFiles={() => {
            // Mode first, then the scroll back to the top: what the reader
            // asked for must not depend on a scroll succeeding.
            onLensOn(false);
            onSelect(null);
          }}
          onShowLens={() => {
            onLensOn(true);
            onSelect(null);
          }}
          onRun={onRunLens}
          onManage={onOpenLenses}
        />
      </div>

      <DiffFileTree
        files={files}
        groups={lensOn ? groups : null}
        collapsed={collapsed}
        onCollapsedChange={(id, next) => useGithubStore.getState().setGroupCollapsed(id, next)}
        onFileClick={onSelect}
        renderFileTrailing={(file, hunks, section) => trailing(file.path, hunks, section)}
        activeSection={activeSection}
        revealing={revealing}
      />
    </div>
  );
}
