import { useMemo } from 'react';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import type { ResolvedGroup } from '../../lens/lens';
import type { StoredLens } from '../../lens/readLens';
import type { LensSummary } from '../../lens/config';
import { DiffFileTree, DiffFileTreeChapters } from '../diff/DiffFileTree';
import { useGithubStore } from '../../stores/githubStore';
import { Icon } from '../terminal/Icon';
import { usePullRequestSignals } from '../../hooks/usePullRequestSignals';
import { AnalysisRailDot } from '../diff/AnalysisChip';
import { LensPicker } from '../diff/LensPicker';
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
  /** The lenses the project keeps, for the picker to offer. */
  lenses: LensSummary[];
  /** Read this pull request through one — an agent run. */
  onRunLens: (lens: LensSummary) => void;
  /** Opens the project's lenses, to add or edit one. */
  onOpenLenses: () => void;
  /** The lens being written, if one is running. */
  lensWriting: LensRun | null;
  /** Set by dragging the seam beside this. */
  width: number;
}

/**
 * The changed files, for the code pane only.
 *
 * With a lens on, the same rail lists the parts of the change instead — and a
 * file that belongs to three parts appears in all three, because that is the
 * point of it.
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
  width,
}: PullRequestRailProps) {
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const viewedPaths = useGithubStore((s) => s.viewedPaths);
  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);
  const activePath = useGithubStore((s) => s.activePath);
  const collapsedGroups = useGithubStore((s) => s.collapsedGroups);
  const collapsed = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);

  const signals = usePullRequestSignals(detail.headSha, files);

  const unresolvedByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of detail.threads) {
      if (thread.isResolved) continue;
      counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
    }
    return counts;
  }, [detail.threads]);

  const trailing = (path: string, hunks?: number) => {
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
        {viewed.has(path) && <Icon name="check" className="shrink-0 w-3 h-3 text-accent/70" />}
      </>
    );
  };

  return (
    // No right border: the seam beside this is the boundary.
    <div className="shrink-0 flex flex-col overflow-hidden" style={{ width }}>
      {/* A diff arrives in the order the change was stored, not the order it
          reads in. A lens is one answer to that, written for this change and no
          other — and the flat file list is the answer you get when nothing has
          been written, so the two are one choice made in one place. */}
      {/* `h-9` is a file card's header. This pane has no toolbar over it, so
          what the ledge meets across the seam is a header stuck to the top of
          the well — which is where one sits for as long as the diff is being
          read, the well's opening gap notwithstanding. */}
      <div className="pane-ledge shrink-0 flex flex-col h-9">
        <LensPicker
          lenses={lenses}
          onFile={onFile}
          lensOn={lensOn}
          changedFiles={detail.changedFiles}
          viewed={viewed.size}
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

      {lensOn && groups ? (
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          <DiffFileTreeChapters
            groups={groups}
            byPath={byPath}
            collapsed={collapsed}
            onCollapsedChange={(title, next) => useGithubStore.getState().setGroupCollapsed(title, next)}
            onFileClick={onSelect}
            renderFileTrailing={(file, hunks) => trailing(file.path, hunks)}
            activePath={activePath}
          />
        </div>
      ) : (
        <DiffFileTree
          files={files}
          activePath={activePath}
          onFileClick={onSelect}
          renderFileTrailing={(file) => trailing(file.path)}
        />
      )}
    </div>
  );
}

/** The files one part of the change claims, in the order the lens put them. */
