import { useMemo, useState, type ReactNode } from 'react';
import type { ChangedFile } from '../../types';
import type { ResolvedGroup } from '../../lens/lens';
import { Icon } from '../terminal/Icon';
import { statusIcon, statusColorClass, badgeColorClass } from './diffStatus';

interface TreeNode<T = ChangedFile> {
  name: string;
  fullPath: string;
  isFile: boolean;
  file?: T;
  children: TreeNode<T>[];
}

export function buildTree<T extends { path: string }>(files: readonly T[]): TreeNode<T>[] {
  const root: TreeNode<T>[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === name && n.isFile === isFile);
      if (!existing) {
        existing = { name, fullPath, isFile, children: [], file: isFile ? file : undefined };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  // Sorted here, not at render: `treeFileOrder` walks this tree to order the
  // document, so a sort applied later would leave the two disagreeing.
  function collapse(nodes: TreeNode<T>[]): TreeNode<T>[] {
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

function sortTreeNodes<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
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

  const walk = (nodes: TreeNode<{ path: string }>[]) => {
    for (const node of nodes) {
      if (node.isFile && node.file) order.push(node.file.path);
      else walk(node.children);
    }
  };

  walk(buildTree(files));
  return order;
}

export function inTreeOrder<T extends { path: string }>(files: readonly T[]): T[] {
  const rank = new Map(treeFileOrder(files).map((path, index) => [path, index]));
  return [...files].sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0));
}

export interface DiffFileTreeProps {
  files: ChangedFile[];
  onFileClick: (path: string, group?: string) => void;
  /** The lens as bound to this diff. Null runs the flat tree. */
  groups?: ResolvedGroup[] | null;
  /** Parts folded away, by title. */
  collapsed?: ReadonlySet<string>;
  onCollapsedChange?: (title: string, next: boolean) => void;
  /** Per-file trailing content — the PR view puts unresolved-thread counts here. */
  renderFileTrailing?: (file: ChangedFile) => ReactNode;
  /** Content above the tree — the PR view puts the rest of its contents here. */
  header?: ReactNode;
  /** Path currently in view, highlighted in the rail. */
  activePath?: string | null;
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
  activePath?: string | null;
}) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <>
      {tree.map((node) => (
        <TreeNodeView
          key={node.fullPath}
          node={node}
          onFileClick={onFileClick}
          renderFileTrailing={renderFileTrailing}
          activePath={activePath}
        />
      ))}
    </>
  );
}

/**
 * The same files under the lens's headings, each part folding like a folder.
 *
 * The tree is kept inside every part rather than flattened to basenames: which
 * directories a part of the change touches is most of what says what kind of
 * change it is, so a grouping that hides them answered the easy half of the
 * question.
 */
export function DiffFileTreeChapters<T extends ChangedFile>({
  groups,
  byPath,
  collapsed,
  onCollapsedChange,
  onFileClick,
  renderFileTrailing,
  activePath,
}: {
  groups: ResolvedGroup[];
  byPath: Map<string, T>;
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (title: string, next: boolean) => void;
  onFileClick: (path: string, group: string) => void;
  renderFileTrailing?: (file: T, hunks?: number) => ReactNode;
  activePath?: string | null;
}) {
  return (
    <>
      {groups.map((group, at) => {
        const folded = collapsed.has(group.title);
        // Counted as the part claims them, so the rail and the card it scrolls
        // to do not report a file split across three parts three times over.
        const files = group.slices.flatMap((slice) => {
          const file = byPath.get(slice.path);
          if (!file) return [];
          return [slice.changes ? { ...file, ...slice.changes } : file];
        });
        return (
          // Indexed: two parts of a lens may carry the same title, and a key
          // that is only the title keeps one of them.
          <div key={`${at}:${group.title}`} className="flex flex-col">
            {/* Set as the lens wrote it. Uppercasing a title shouts, and
                algorithmic title case would spell GitHub "Github".

                No caret at the head of the line, where every directory below
                already has one: a part of the change and a folder of files are
                different kinds of thing, and giving them the same mark in the
                same column made the list read as one tree. The toggle sits at
                the far end instead, and says plus or minus rather than
                pointing. */}
            <button
              type="button"
              aria-expanded={!folded}
              className="flex items-center gap-1.5 h-9 px-3 text-[12px] font-medium text-ink/90 text-left transition-colors duration-150 ease-out hover:bg-ink/5"
              title={group.summary}
              onClick={() => onCollapsedChange(group.title, !folded)}
            >
              <span className="min-w-0 flex-1 truncate">{group.title}</span>
              <Icon name={folded ? 'plus' : 'minus'} className="shrink-0 !w-3 !h-3 opacity-50" />
            </button>
            {!folded && (
              <DiffFileTreeNodes
                files={files}
                activePath={activePath}
                onFileClick={(path) => onFileClick(path, group.title)}
                renderFileTrailing={
                  renderFileTrailing ? (file) => renderFileTrailing(file, hunksOf(group, file.path)) : undefined
                }
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** How many hunks of a file one part of the change claims. */
export function hunksOf(group: ResolvedGroup, path: string): number | undefined {
  return group.slices.find((slice) => slice.path === path)?.hunks.length;
}

export function DiffFileTree({
  files,
  onFileClick,
  groups,
  collapsed,
  onCollapsedChange,
  renderFileTrailing,
  header,
  activePath,
  footer,
}: DiffFileTreeProps) {
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const chaptered = groups && collapsed && onCollapsedChange;

  return (
    // Chaptered, the list opens with a part's bar, which is level with the one
    // the document opens with across the seam. Padding above it would drop the
    // rail's half of that band by the height of the padding.
    <div className={`flex-1 overflow-y-auto pb-2 ${chaptered ? '' : 'pt-2'}`}>
      {header}
      {chaptered ? (
        <DiffFileTreeChapters
          groups={groups}
          byPath={byPath}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          onFileClick={onFileClick}
          renderFileTrailing={renderFileTrailing}
          activePath={activePath}
        />
      ) : (
        <DiffFileTreeNodes
          files={files}
          onFileClick={onFileClick}
          renderFileTrailing={renderFileTrailing}
          activePath={activePath}
        />
      )}
      {footer}
    </div>
  );
}

function TreeNodeView<T extends ChangedFile>({
  node,
  onFileClick,
  renderFileTrailing,
  activePath,
}: {
  node: TreeNode<T>;
  onFileClick: (path: string) => void;
  renderFileTrailing?: (file: T) => ReactNode;
  activePath?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.isFile && node.file) {
    const file = node.file;
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
