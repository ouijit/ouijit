import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { ChangedFile, FileDiff, DiffHunk, DiffLine } from '../../types';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';

interface DiffPanelProps {
  ptyId: string;
  projectPath: string;
  onClose: () => void;
}

export function DiffPanel({ ptyId, projectPath, onClose }: DiffPanelProps) {
  const mode = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelMode ?? 'uncommitted');
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [diffs, setDiffs] = useState<Map<string, FileDiff | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const instance = terminalInstances.get(ptyId);
  const gitPath = instance?.worktreePath || projectPath;

  // Load changed files
  useEffect(() => {
    setLoading(true);
    setDiffs(new Map());

    const load = async () => {
      let changedFiles: ChangedFile[];
      if (mode === 'worktree' && instance?.worktreeBranch) {
        const result = await window.api.worktree.getDiff(projectPath, instance.worktreeBranch);
        changedFiles = result?.files ?? [];
      } else {
        changedFiles = await window.api.getChangedFiles(gitPath);
      }
      setFiles(changedFiles);
      setLoading(false);

      // Update store
      useTerminalStore.getState().updateDisplay(ptyId, {
        diffPanelFiles: changedFiles,
      });

      // Load all diffs concurrently
      const results = new Map<string, FileDiff | null>();
      await Promise.all(
        changedFiles.map(async (file) => {
          try {
            let diff: FileDiff | null;
            if (mode === 'worktree' && instance?.worktreeBranch) {
              diff = await window.api.worktree.getFileDiff(projectPath, instance.worktreeBranch, file.path);
            } else {
              diff = await window.api.getFileDiff(gitPath, file.path);
            }
            results.set(file.path, diff);
            // Update incrementally
            setDiffs((prev) => new Map(prev).set(file.path, diff));
          } catch {
            results.set(file.path, null);
          }
        }),
      );
    };

    load();
  }, [ptyId, mode, gitPath, projectPath, instance?.worktreeBranch]);

  const scrollToFile = useCallback((path: string) => {
    const section = contentRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Header stats
  const stats = useMemo(() => {
    const total = files.length;
    const untracked = files.filter((f) => f.status === '?').length;
    const additions = files.reduce((s, f) => s + f.additions, 0);
    const deletions = files.reduce((s, f) => s + f.deletions, 0);

    let text = `${total} file${total !== 1 ? 's' : ''}`;
    if (untracked > 0) text += ` (${untracked} untracked)`;
    if (additions > 0) text += ` +${additions}`;
    if (deletions > 0) text += ` -${deletions}`;
    return text;
  }, [files]);

  const modeLabel = mode === 'worktree' ? 'Branch changes' : 'Uncommitted changes';

  return (
    <div className="diff-panel diff-panel--visible">
      <div className={`diff-panel-sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <DiffFileTree files={files} onFileClick={scrollToFile} />
      </div>
      <div className="diff-panel-main">
        <div className="diff-content-header">
          <button
            className={`diff-sidebar-toggle${sidebarCollapsed ? ' collapsed' : ''}`}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <Icon name={sidebarCollapsed ? 'caret-right' : 'caret-left'} />
          </button>
          <span className="compare-mode-selector">{modeLabel}</span>
          <span className="diff-header-info">{stats}</span>
          <button className="diff-panel-close" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </div>
        <div ref={contentRef} className="diff-content-body">
          {loading && <div className="diff-empty-state">Loading changes...</div>}
          {!loading && files.length === 0 && <div className="diff-empty-state">No changes</div>}
          {!loading &&
            files.map((file) => <DiffFileSection key={file.path} file={file} diff={diffs.get(file.path) ?? null} />)}
        </div>
      </div>
    </div>
  );
}

// ── File tree sidebar ────────────────────────────────────────────────

interface TreeNode {
  name: string;
  fullPath: string;
  isFile: boolean;
  file?: ChangedFile;
  children: TreeNode[];
}

function buildTree(files: ChangedFile[]): TreeNode[] {
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

  // Collapse single-child directories
  function collapse(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
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
  }

  return collapse(root);
}

function DiffFileTree({ files, onFileClick }: { files: ChangedFile[]; onFileClick: (path: string) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="diff-panel-file-list">
      {tree.map((node) => (
        <TreeNodeView key={node.fullPath} node={node} onFileClick={onFileClick} depth={0} />
      ))}
    </div>
  );
}

function TreeNodeView({
  node,
  onFileClick,
  depth,
}: {
  node: TreeNode;
  onFileClick: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.isFile && node.file) {
    return (
      <div
        className="diff-tree-file"
        data-path={node.file.path}
        style={{ paddingLeft: `${12 * depth}px` }}
        onClick={() => onFileClick(node.file!.path)}
      >
        <span className={`diff-file-icon diff-file-icon--${statusClass(node.file.status)}`}>
          <Icon name={statusIcon(node.file.status)} />
        </span>
        <span className="diff-tree-name">{node.name}</span>
        {node.file.status === '?' && <span className="diff-file-badge diff-file-badge--untracked">untracked</span>}
        {(node.file.additions > 0 || node.file.deletions > 0) && (
          <span className="diff-panel-file-stats">
            {node.file.additions > 0 && `+${node.file.additions}`}
            {node.file.additions > 0 && node.file.deletions > 0 && ' '}
            {node.file.deletions > 0 && `-${node.file.deletions}`}
          </span>
        )}
      </div>
    );
  }

  // Directory node
  return (
    <div className="diff-tree-dir" data-expanded={expanded}>
      <div
        className="diff-tree-dir-label"
        style={{ paddingLeft: `${12 * depth}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="diff-tree-chevron">
          <Icon name={expanded ? 'caret-down' : 'caret-right'} />
        </span>
        <span className="diff-tree-name">{node.name}</span>
      </div>
      {expanded && (
        <div className="diff-tree-dir-children">
          {sortTreeNodes(node.children).map((child) => (
            <TreeNodeView key={child.fullPath} node={child} onFileClick={onFileClick} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function statusIcon(status: string): string {
  switch (status) {
    case 'A':
    case '?':
      return 'file-plus';
    case 'D':
      return 'file-minus';
    case 'R':
      return 'file-text';
    default:
      return 'file-dashed';
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case '?':
      return 'untracked';
    default:
      return 'modified';
  }
}

// ── Diff file section ────────────────────────────────────────────────

function DiffFileSection({ file, diff }: { file: ChangedFile; diff: FileDiff | null }) {
  const badgeClass = `diff-file-badge diff-file-badge--${statusClass(file.status)}`;
  const badgeLabel =
    file.status === '?'
      ? 'untracked'
      : file.status === 'A'
        ? 'added'
        : file.status === 'D'
          ? 'deleted'
          : file.status === 'R'
            ? 'renamed'
            : 'modified';

  return (
    <div className="diff-file-section" data-path={file.path}>
      <div className="diff-file-section-header">
        <span className="diff-file-section-name" title={file.path}>
          {file.path}
        </span>
        <span className={badgeClass}>{badgeLabel}</span>
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="diff-file-section-stats">
            {file.additions > 0 && <span className="project-card-git-add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="project-card-git-del">-{file.deletions}</span>}
          </span>
        )}
      </div>
      <div className="diff-file-section-body">
        {diff === null ? (
          <div className="diff-empty-state">Loading...</div>
        ) : diff.hunks.length === 0 ? (
          <div className="diff-empty-state">No diff available</div>
        ) : (
          <div className="diff-hunks-wrapper">
            {diff.hunks.map((hunk, i) => (
              <DiffHunkView key={i} hunk={hunk} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffHunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="diff-hunk">
      <div className="diff-hunk-header">{hunk.header}</div>
      {hunk.lines.map((line, i) => (
        <DiffLineView key={i} line={line} />
      ))}
    </div>
  );
}

function DiffLineView({ line }: { line: DiffLine }) {
  const lineClass = `diff-line diff-line--${line.type}`;
  const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';

  return (
    <div className={lineClass}>
      <span className="diff-line-numbers">
        <span className="diff-line-number">{line.oldLineNo ?? ''}</span>
        <span className="diff-line-number">{line.newLineNo ?? ''}</span>
      </span>
      <span className="diff-line-content">
        {prefix}
        {line.content}
      </span>
    </div>
  );
}
