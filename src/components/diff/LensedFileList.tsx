import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { LensGroupSection } from './LensGroupSection';
import { sectionKey, type ResolvedGroup, type ResolvedSlice } from '../../lens/lens';

export interface LensedFileListProps<T extends { path: string }> {
  files: readonly T[];
  /** The order the tree shows these files in, which the document follows. */
  order: readonly string[];
  /** The lens's groups, or null to run the files flat in tree order. */
  groups: ResolvedGroup[] | null;
  /**
   * `key` is this copy's identity: a lens can name the same file in three parts,
   * and what is folded, marked read or scrolled to is one of them. `slice` is the
   * part of the file shown.
   */
  renderFile: (file: T, key?: string, slice?: ResolvedSlice) => ReactNode;
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (groupId: string, next: boolean) => void;
  /** The grouping has just arrived, so its parts lay themselves in. */
  revealing?: boolean;
}

/** A slice naming a file the diff no longer has is dropped, not drawn empty. */
export function LensedFileList<T extends { path: string }>({
  files,
  order,
  groups,
  renderFile,
  collapsed,
  onCollapsedChange,
  revealing,
}: LensedFileListProps<T>) {
  // Each branch's work and only that branch's: with a lens on, a batch of diffs
  // arriving would otherwise re-sort every file for a list nothing draws.
  const byPath = useMemo(() => (groups ? new Map(files.map((f) => [f.path, f])) : null), [groups, files]);
  const ordered = useMemo(() => {
    if (groups) return [];
    const rank = new Map(order.map((path, at) => [path, at]));
    return [...files].sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0));
  }, [groups, files, order]);

  if (!groups || !byPath) return <>{ordered.map((file) => renderFile(file))}</>;

  return (
    <>
      {groups.map((group, at) => (
        <LensGroupSection
          key={group.id}
          group={group}
          collapsed={collapsed.has(group.id)}
          onCollapsedChange={(next) => onCollapsedChange(group.id, next)}
          revealIndex={revealing ? at : undefined}
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
