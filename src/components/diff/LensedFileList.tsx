import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { LensGroupSection } from './LensGroupSection';
import { partDelay } from './lensReveal';
import { sectionKey, type ResolvedGroup, type ResolvedSlice } from '../../lens/lens';

export interface LensedFileListProps<T extends { path: string }> {
  files: readonly T[];
  /**
   * The order the tree shows these files in. Taken rather than worked out again,
   * so the document and the rail cannot disagree about where a file sits.
   */
  order: readonly string[];
  /** The lens's groups, or null to run the files flat in tree order. */
  groups: ResolvedGroup[] | null;
  /**
   * One file's section. `key` is this copy's identity: a lens may name the same
   * file in three parts, and what is folded, marked read or scrolled to is one
   * part of one file. `slice` is the part of it shown.
   */
  renderFile: (file: T, key?: string, slice?: ResolvedSlice) => ReactNode;
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (title: string, next: boolean) => void;
  /** The grouping has just arrived, so its parts lay themselves in. */
  revealing?: boolean;
}

/**
 * A diff's files, either grouped by a lens or flat. A slice naming a file the
 * diff no longer has is dropped rather than drawn empty.
 */
export function LensedFileList<T extends { path: string }>({
  files,
  order,
  groups,
  renderFile,
  collapsed,
  onCollapsedChange,
  revealing,
}: LensedFileListProps<T>) {
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const ordered = useMemo(() => {
    const rank = new Map(order.map((path, at) => [path, at]));
    return [...files].sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0));
  }, [files, order]);

  if (!groups) return <>{ordered.map((file) => renderFile(file))}</>;

  return (
    <>
      {groups.map((group, at) => (
        <LensGroupSection
          key={group.id}
          group={group}
          collapsed={collapsed.has(group.id)}
          onCollapsedChange={(next) => onCollapsedChange(group.id, next)}
          revealDelay={revealing ? partDelay(at) : undefined}
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
