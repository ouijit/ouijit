import { useMemo, useState, type ReactNode } from 'react';
import type { ChangedFile } from '../../types';
import { Icon } from '../terminal/Icon';
import { statusIcon, statusColorClass, badgeColorClass } from './diffStatus';

/**
 * The changed-file sidebar, shared by the worktree diff panel and the pull
 * request files view.
 *
 * Untracked files are optional — a PR has no such concept — and callers can
 * append their own footer (the PR view uses it for the "N files not shown" cap
 * notice).
 */

interface TreeNode {
  name: string;
  fullPath: string;
  isFile: boolean;
  file?: ChangedFile;
  children: TreeNode[];
}

export function buildTree(files: ChangedFile[]): TreeNode[] {
  const root: TreeNode[] = [];

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

  // Collapse single-child directories, and sort as we go.
  //
  // Sorted here rather than at the point of rendering, which is where it used
  // to be: the walk that gives the document its order reads this tree, so a
  // sort applied on the way to the screen was a sort the document never saw.
  // The rail and the document then disagreed about the order of every
  // directory with more than one thing in it.
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
    // After collapsing, so a folded-up `src/github` sorts under the name it is
    // shown as rather than the one it was built from.
    return sortTreeNodes(collapsed);
  }

  return collapse(root);
}

/** Directories first, then by name — one order, wherever the tree is read. */
function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The order the tree shows these files in.
 *
 * The tree nests by directory, so two files that share one sit together
 * however far apart they were in the list that arrived — and that list arrives
 * in whatever order GitHub or git chose. The document has to follow it: a rail
 * whose order is not the order you scroll through is a rail you cannot use to
 * keep your place.
 *
 * Built by the same function that builds the tree, rather than by sorting to
 * the same rule twice. Two implementations of one order are two things to keep
 * in step, and this is exactly the bug that comes of missing.
 */
export function treeFileOrder(files: readonly { path: string }[]): string[] {
  const order: string[] = [];

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.isFile && node.file) order.push(node.file.path);
      else walk(node.children);
    }
  };

  walk(buildTree(files.map((file) => ({ ...file, status: 'M', additions: 0, deletions: 0 }) as ChangedFile)));
  return order;
}

/** Sorts anything with a path into the order the tree shows it in. */
export function inTreeOrder<T extends { path: string }>(files: readonly T[]): T[] {
  const rank = new Map(treeFileOrder(files).map((path, index) => [path, index]));
  return [...files].sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0));
}

export interface DiffFileTreeProps {
  files: ChangedFile[];
  /** Only the worktree view has these; a PR never does. */
  untrackedFiles?: string[];
  onFileClick: (path: string) => void;
  /** Per-file trailing content — the PR view puts unresolved-thread counts here. */
  renderFileTrailing?: (file: ChangedFile) => ReactNode;
  /** Content above the tree — the PR view puts the rest of its contents here. */
  header?: ReactNode;
  /** Path currently in view, marked so the rail reports where the reader is. */
  activePath?: string | null;
  footer?: ReactNode;
}

/**
 * Just the nodes, for somewhere that already owns its scrolling.
 *
 * A lens groups the same files under headings, and each group still wants the
 * directories: which layer a change touches is most of what tells a reviewer
 * what kind of change it is, and a flat list of basenames throws that away
 * exactly where the grouping was supposed to explain it.
 */
export function DiffFileTreeNodes({
  files,
  onFileClick,
  renderFileTrailing,
  activePath,
}: Pick<DiffFileTreeProps, 'files' | 'onFileClick' | 'renderFileTrailing' | 'activePath'>) {
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

export function DiffFileTree({
  files,
  untrackedFiles = [],
  onFileClick,
  renderFileTrailing,
  header,
  activePath,
  footer,
}: DiffFileTreeProps) {
  const [untrackedExpanded, setUntrackedExpanded] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {header}
      <DiffFileTreeNodes
        files={files}
        onFileClick={onFileClick}
        renderFileTrailing={renderFileTrailing}
        activePath={activePath}
      />
      {untrackedFiles.length > 0 && (
        <>
          <div
            className="flex items-center gap-1.5 py-1 pl-3 pr-3 mt-1 border-t border-ink/[0.06] text-[13px] text-ink/40 transition-colors duration-150 ease-out hover:bg-ink/5 hover:text-ink/60"
            onClick={() => setUntrackedExpanded(!untrackedExpanded)}
          >
            <Icon name={untrackedExpanded ? 'caret-down' : 'caret-right'} className="!w-3 !h-3" />
            <span>{untrackedFiles.length} untracked</span>
          </div>
          {untrackedExpanded &&
            untrackedFiles.map((filePath) => (
              <div key={filePath} className="flex items-center gap-1.5 py-1 pl-6 pr-3 text-[13px] text-ink/40">
                <Icon name="file-plus" className="w-4 h-4 text-vcs-modified" />
                <span className="flex-1 min-w-0 truncate">{filePath}</span>
              </div>
            ))}
        </>
      )}
      {footer}
    </div>
  );
}

function TreeNodeView({
  node,
  onFileClick,
  renderFileTrailing,
  activePath,
}: {
  node: TreeNode;
  onFileClick: (path: string) => void;
  renderFileTrailing?: (file: ChangedFile) => ReactNode;
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

  // Directory node
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
