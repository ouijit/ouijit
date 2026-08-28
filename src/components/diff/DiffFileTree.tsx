import { useMemo, useState, type ReactNode } from 'react';
import type { ChangedFile } from '../../types';
import { sectionKey, sectionPath, type ResolvedGroup } from '../../lens/lens';
import { Icon } from '../terminal/Icon';
import { statusIcon, statusColorClass, badgeColorClass } from './diffStatus';
import { partEnter } from './lensReveal';

/**
 * Under a lens a row is one part of a file, so anything about how far through it
 * the reader is takes `section`, not `file`.
 */
type FileTrailing<T> = (file: T, hunks?: number, section?: string) => ReactNode;

/**
 * Paths only: a file's status and line counts arrive in batches while the diff
 * loads, and a tree holding those objects would be rebuilt on every batch.
 */
interface TreeNode {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: TreeNode[];
}

function buildTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const path of paths) {
    const parts = path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === name && n.isFile === isFile);
      if (!existing) {
        existing = { name, fullPath, isFile, children: [] };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  // Sorted here, not at render: `treeFileOrder` walks this tree to order the
  // document, so a sort applied later would leave the two disagreeing.
  function collapse(nodes: TreeNode[]): TreeNode[] {
    const collapsed = nodes.map((node) => {
      if (!node.isFile && node.children.length === 1 && !node.children[0].isFile) {
        const child = node.children[0];
        return {
          ...child,
          name: `${node.name}/${child.name}`,
          children: collapse(child.children),
        };
      }
      return { ...node, children: collapse(node.children) };
    });
    // After collapsing, so a folded-up `src/github` sorts under its shown name.
    return sortTreeNodes(collapsed);
  }

  return collapse(root);
}

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The order the tree shows these files in. The document must follow it, or
 * clicking a file in the rail is no way to find it in the diff.
 */
export function treeFileOrder(files: readonly { path: string }[]): string[] {
  const order: string[] = [];

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.isFile) order.push(node.fullPath);
      else walk(node.children);
    }
  };

  walk(buildTree(files.map((file) => file.path)));
  return order;
}

export interface DiffFileTreeProps {
  files: ChangedFile[];
  onFileClick: (path: string, group?: string) => void;
  /** Absent, or with null groups, runs the flat tree. */
  lens?: {
    groups: ResolvedGroup[] | null;
    collapsed: ReadonlySet<string>;
    onCollapsedChange: (id: string, next: boolean) => void;
  };
  renderFileTrailing?: FileTrailing<ChangedFile>;
  header?: ReactNode;
  /** The section in view, marked in the rail — the path itself when no lens splits it. */
  activeSection?: string | null;
  /** The grouping has just arrived, so its parts lay themselves in. */
  revealing?: boolean;
  footer?: ReactNode;
}

/** Just the nodes, for a caller that already owns its scrolling. */
export function DiffFileTreeNodes<T extends ChangedFile>({
  files,
  onFileClick,
  renderFileTrailing,
  activePath,
}: {
  files: readonly T[];
  onFileClick: (path: string) => void;
  renderFileTrailing?: (file: T) => ReactNode;
  /** The file being read, or null when it is not one of these. */
  activePath?: string | null;
}) {
  const paths = useMemo(() => files.map((file) => file.path).join('\n'), [files]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the fingerprint is the point: it changes only when the list does
  const tree = useMemo(() => buildTree(files.map((file) => file.path)), [paths]);
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  return (
    <>
      {tree.map((node) => (
        <TreeNodeView
          key={node.fullPath}
          node={node}
          byPath={byPath}
          onFileClick={onFileClick}
          renderFileTrailing={renderFileTrailing}
          activePath={activePath}
        />
      ))}
    </>
  );
}

function DiffFileTreeChapters<T extends ChangedFile>({
  groups,
  byPath,
  collapsed,
  onCollapsedChange,
  onFileClick,
  renderFileTrailing,
  activeSection,
  revealing,
}: {
  groups: ResolvedGroup[];
  byPath: Map<string, T>;
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (id: string, next: boolean) => void;
  onFileClick: (path: string, group: string) => void;
  renderFileTrailing?: FileTrailing<T>;
  activeSection?: string | null;
  revealing?: boolean;
}) {
  // `DiffFileTreeNodes` memoises its tree on the array it is handed, so rebuilding
  // these in the render rebuilds every part's tree on every scroll. Counts are the
  // part's own, or a file in three parts reports its whole diff in each.
  const parts = useMemo(() => {
    const built = new Map<string, { files: T[]; hunks: Map<string, number> }>();
    for (const group of groups) {
      const files: T[] = [];
      const hunks = new Map<string, number>();
      for (const slice of group.slices) {
        const file = byPath.get(slice.path);
        if (!file) continue;
        files.push(slice.changes ? { ...file, ...slice.changes } : file);
        hunks.set(slice.path, slice.hunks.length);
      }
      built.set(group.id, { files, hunks });
    }
    return built;
  }, [groups, byPath]);

  return (
    <>
      {groups.map((group, at) => {
        const folded = collapsed.has(group.id);
        const { files, hunks } = parts.get(group.id)!;
        // The mark is on one copy of a file, not on every part that names it.
        const activePath = sectionPath(activeSection, group.id);
        const enter = partEnter(revealing ? at : undefined);
        return (
          <div key={group.id} className={`flex flex-col ${enter.className}`} style={enter.style}>
            {/* The toggle is at the far end: a caret here, in the column every
                directory below uses, made a part and a folder read as one tree. */}
            <button
              type="button"
              aria-expanded={!folded}
              className="flex items-center gap-1.5 h-9 px-3 text-[12px] font-medium text-ink/90 text-left transition-colors duration-150 ease-out hover:bg-ink/5"
              title={group.summary}
              onClick={() => onCollapsedChange(group.id, !folded)}
            >
              <span className="min-w-0 flex-1 truncate">{group.title}</span>
              <Icon name={folded ? 'plus' : 'minus'} className="shrink-0 !w-3 !h-3 opacity-50" />
            </button>
            {!folded && (
              <DiffFileTreeNodes
                files={files}
                activePath={activePath}
                onFileClick={(path) => onFileClick(path, group.id)}
                renderFileTrailing={
                  renderFileTrailing
                    ? (file) => renderFileTrailing(file, hunks.get(file.path), sectionKey(group.id, file.path))
                    : undefined
                }
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function DiffFileTree({
  files,
  onFileClick,
  lens,
  renderFileTrailing,
  header,
  activeSection,
  revealing,
  footer,
}: DiffFileTreeProps) {
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const chaptered = lens?.groups;

  return (
    // Chaptered, the list opens with a part's bar, which has to sit level with the
    // one the document opens with across the seam.
    <div className={`flex-1 overflow-y-auto pb-2 ${chaptered ? '' : 'pt-2'}`}>
      {header}
      {chaptered ? (
        <DiffFileTreeChapters
          groups={chaptered}
          byPath={byPath}
          collapsed={lens.collapsed}
          onCollapsedChange={lens.onCollapsedChange}
          onFileClick={onFileClick}
          renderFileTrailing={renderFileTrailing}
          activeSection={activeSection}
          revealing={revealing}
        />
      ) : (
        <DiffFileTreeNodes
          files={files}
          onFileClick={onFileClick}
          renderFileTrailing={renderFileTrailing}
          activePath={activeSection}
        />
      )}
      {footer}
    </div>
  );
}

function TreeNodeView<T extends ChangedFile>({
  node,
  byPath,
  onFileClick,
  renderFileTrailing,
  activePath,
}: {
  node: TreeNode;
  byPath: Map<string, T>;
  onFileClick: (path: string) => void;
  renderFileTrailing?: (file: T) => ReactNode;
  activePath?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const file = node.isFile ? byPath.get(node.fullPath) : undefined;

  if (file) {
    const isActive = activePath === file.path;
    return (
      <div
        className={`flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] transition-colors duration-150 ease-out hover:bg-ink/5 ${
          isActive ? 'bg-ink/[0.07] text-ink' : 'text-ink/70'
        }`}
        data-path={file.path}
        onClick={() => onFileClick(file.path)}
      >
        <Icon name={statusIcon(file.status)} className={`w-4 h-4 ${statusColorClass(file.status)}`} />
        <span className="flex-1 min-w-0 truncate">{node.name}</span>
        {renderFileTrailing?.(file)}
        {file.status === '?' && (
          <span className={`shrink-0 text-[11px] px-1 py-px rounded font-medium ${badgeColorClass('?')}`}>
            untracked
          </span>
        )}
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="shrink-0 font-mono text-[13px]">
            {file.additions > 0 && <span className="text-diff-added">+{file.additions}</span>}
            {file.additions > 0 && file.deletions > 0 && ' '}
            {file.deletions > 0 && <span className="text-diff-removed">-{file.deletions}</span>}
          </span>
        )}
      </div>
    );
  }

  return (
    <div data-expanded={expanded}>
      <div
        className="flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] text-ink/50 transition-colors duration-150 ease-out hover:bg-ink/5 hover:text-ink/70"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="!w-3 !h-3" />
        <span className="flex-1 min-w-0 truncate">{node.name}</span>
      </div>
      {expanded && (
        <div className="pl-3">
          {node.children.map((child) => (
            <TreeNodeView
              key={child.fullPath}
              node={child}
              byPath={byPath}
              onFileClick={onFileClick}
              renderFileTrailing={renderFileTrailing}
              activePath={activePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
