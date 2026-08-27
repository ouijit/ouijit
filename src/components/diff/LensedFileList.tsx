import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { LensGroupSection } from './LensGroupSection';
import { inTreeOrder } from './DiffFileTree';
import { sectionKey, type ResolvedGroup, type ResolvedSlice } from '../../lens/lens';

export interface LensedFileListProps<T extends { path: string }> {
  files: readonly T[];
  /** The lens's groups, or null to run the files flat in tree order. */
  groups: ResolvedGroup[] | null;
  /**
   * One file's section. `key` is this copy's identity — a lens may name the
   * same file in three parts, and what is folded, marked read or scrolled to
   * is one part of one file, not the file. `slice` is the part of it shown.
   */
  renderFile: (file: T, key?: string, slice?: ResolvedSlice) => ReactNode;
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (title: string, next: boolean) => void;
}

/**
 * A diff's files, either grouped by a lens or flat.
 *
 * Both diffs render this — the pull request's and the worktree's — so the two
 * agree on the order files run in, on the key a lens's repeated file gets, and
 * on what happens to a slice naming a file the diff no longer has (it is
 * dropped, rather than rendering an empty section).
 */
export function LensedFileList<T extends { path: string }>({
  files,
  groups,
  renderFile,
  collapsed,
  onCollapsedChange,
}: LensedFileListProps<T>) {
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  // The tree groups by directory; the document has to run in the same order or
  // clicking a file in one is no way to find it in the other.
  const ordered = useMemo(() => inTreeOrder(files), [files]);

  if (!groups) return <>{ordered.map((file) => renderFile(file))}</>;

  return (
    <>
      {groups.map((group) => (
        <LensGroupSection
          key={group.id}
          group={group}
          collapsed={collapsed.has(group.id)}
          onCollapsedChange={(next) => onCollapsedChange(group.id, next)}
        >
          {group.slices.map((slice) => {
            const file = byPath.get(slice.path);
            return file ? renderFile(file, sectionKey(group.id, slice.path), slice) : null;
          })}
        </LensGroupSection>
      ))}
    </>
  );
}
