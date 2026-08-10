import { useMemo } from 'react';
import type { ChangedFile } from '../../types';
import type { PullRequestDetail, PullRequestFile } from '../../github/types';
import type { ResolvedGroup } from '../../github/lens';
import type { LensSummary } from '../../github/service';
import { DiffFileTree, DiffFileTreeNodes } from '../diff/DiffFileTree';
import { useGithubStore } from '../../stores/githubStore';
import { Icon } from '../terminal/Icon';
import { LensPicker } from './LensPicker';

interface PullRequestRailProps {
  detail: PullRequestDetail;
  files: PullRequestFile[];
  /** Take the document to a file — or, with no path, back to the top. */
  onSelect: (path: string | null, group?: string) => void;
  /** The lens as bound to this diff, or null when none has been written. */
  groups: ResolvedGroup[] | null;
  /** Which lens wrote it, when that is known. */
  lensName: string | null;
  lensOn: boolean;
  onLensOn: (on: boolean) => void;
  /** The lenses the project keeps, for the picker to offer. */
  lenses: LensSummary[];
  /** Read this pull request through one — an agent run. */
  onRunLens: (lens: LensSummary) => void;
  /** Opens the project's lenses, to add or edit one. */
  onOpenLenses: () => void;
  /** Name of the lens being written, if one is running. */
  lensWriting: string | null;
  /** Set by dragging the seam beside this. */
  width: number;
}

/**
 * The changed files, for the code pane only.
 *
 * Reviewing a file at a time is the case this is built around: the diff gets
 * the rest of the width, and moving to the next file is one click rather than
 * a scroll past everything in between.
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
  lensName,
  lensOn,
  onLensOn,
  lenses,
  onRunLens,
  onOpenLenses,
  lensWriting,
  width,
}: PullRequestRailProps) {
  const changedFiles: ChangedFile[] = useMemo(() => files.map(toChangedFile), [files]);
  const byPath = useMemo(() => new Map(changedFiles.map((file) => [file.path, file])), [changedFiles]);
  const viewedPaths = useGithubStore((s) => s.viewedPaths);
  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);
  const activePath = useGithubStore((s) => s.activePath);
  const staleLensName = useGithubStore((s) => s.staleLensName);
  const collapsedGroups = useGithubStore((s) => s.collapsedGroups);
  const collapsed = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);

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
        <span key="hunks" className="shrink-0 font-mono text-[10px] text-ink/35" title={`${hunks} hunks here`}>
          {hunks}
        </span>
      ) : null;
    // A file already dealt with says so here too, so how far through a review
    // you are is answerable without scrolling the document to find out.
    const done = viewed.has(path) ? (
      <Icon key="viewed" name="check" className="shrink-0 w-3 h-3 text-accent/70" />
    ) : null;
    if (!count) return share || done ? <>{[share, done]}</> : null;
    return (
      <>
        {share}
        <span className="shrink-0 font-mono text-[10px] text-accent" title="Unresolved threads">
          {count}
        </span>
        {done}
      </>
    );
  };

  return (
    // No right border: the seam beside this is the boundary, and two of them
    // read as a double rule.
    <div className="shrink-0 flex flex-col overflow-hidden" style={{ width }}>
      {/* A diff arrives in the order the change was stored, not the order it
          reads in. A lens is one answer to that, written for this change and no
          other — and the flat file list is the answer you get when nothing has
          been written, so the two are one choice made in one place. */}
      <div className="pane-ledge shrink-0 flex flex-col">
        <LensPicker
          lenses={lenses}
          applied={groups ? { name: lensName, groups: groups.length } : null}
          lensOn={lensOn}
          changedFiles={detail.changedFiles}
          viewed={viewed.size}
          stale={staleLensName}
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
          {groups.map((group) => {
            const folded = collapsed.has(group.title);
            return (
              <div key={group.title} className="flex flex-col">
                {/* Set as the lens wrote it. Uppercasing a title shouts, and
                    algorithmic title case would spell GitHub "Github".

                    No caret at the head of the line, where every directory
                    below already has one: a part of the change and a folder of
                    files are different kinds of thing, and giving them the same
                    mark in the same column made the list read as one tree. The
                    toggle sits at the far end instead, and says plus or minus
                    rather than pointing.

                    Folds with the part it names in the document: one part of
                    the change is one thing, and having it put away on one side
                    of the seam and open on the other is two answers to the same
                    question. */}
                <button
                  type="button"
                  aria-expanded={!folded}
                  className="flex items-center gap-1.5 h-9 px-3 text-[11px] font-medium text-ink/55 text-left transition-colors duration-150 ease-out hover:bg-ink/5 hover:text-ink/75"
                  title={group.summary}
                  onClick={() => useGithubStore.getState().setGroupCollapsed(group.title, !folded)}
                >
                  <span className="min-w-0 flex-1 truncate">{group.title}</span>
                  <Icon name={folded ? 'plus' : 'minus'} className="shrink-0 !w-3 !h-3 opacity-50" />
                </button>
                {/* The same tree the flat list uses. Which directories a part of
                    the change touches is most of what says what kind of change
                    it is, so a grouping that hides them is a grouping that
                    answered the easy half of the question. */}
                {!folded && (
                  <DiffFileTreeNodes
                    files={filesInGroup(group, byPath)}
                    activePath={activePath}
                    onFileClick={(path) => onSelect(path, group.title)}
                    renderFileTrailing={(file) => trailing(file.path, hunkCount(group, file.path))}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <DiffFileTree
          files={changedFiles}
          activePath={activePath}
          onFileClick={onSelect}
          renderFileTrailing={(file) => trailing(file.path)}
        />
      )}
    </div>
  );
}

/** The files one part of the change claims, in the order the lens put them. */
function filesInGroup(group: ResolvedGroup, byPath: Map<string, ChangedFile>): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const slice of group.slices) {
    const file = byPath.get(slice.path);
    if (file) out.push(file);
  }
  return out;
}

function hunkCount(group: ResolvedGroup, path: string): number | undefined {
  return group.slices.find((slice) => slice.path === path)?.hunks.length;
}

function toChangedFile(file: PullRequestFile): ChangedFile {
  return {
    path: file.path,
    status: file.status,
    ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    additions: file.additions,
    deletions: file.deletions,
  };
}
