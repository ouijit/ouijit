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
      <div
        className={
          sidebarCollapsed
            ? 'w-0 overflow-hidden border-r-0 shrink-0 flex flex-col'
            : 'w-[220px] shrink-0 border-r border-white/10 overflow-hidden flex flex-col'
        }
        style={{ transition: 'width 0.2s ease' }}
      >
        <DiffFileTree files={files} onFileClick={scrollToFile} />
      </div>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="px-3 py-2 bg-[#252525] border-b border-white/10 text-sm text-white/70 flex items-center gap-2">
          <button
            className="w-7 h-7 rounded-md bg-transparent border-none text-white/60 flex items-center justify-center shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <Icon name={sidebarCollapsed ? 'caret-right' : 'caret-left'} />
          </button>
          <span
            className="text-xs bg-white/[0.06] pl-2 pr-1 py-1 text-white/50 flex items-center gap-1.5 relative"
            style={{ borderRadius: '5px' }}
          >
            {modeLabel}
          </span>
          <span className="text-xs text-text-tertiary ml-auto relative">{stats}</span>
          <button
            className="w-7 h-7 rounded-md bg-transparent border-none text-white/60 flex items-center justify-center shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-4 [&>svg]:h-4"
            onClick={onClose}
            title="Close"
          >
            <Icon name="x" />
          </button>
        </div>
        <div ref={contentRef} className="flex-1 overflow-auto p-0">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">
              Loading changes...
            </div>
          )}
          {!loading && files.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">No changes</div>
          )}
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
    <div className="flex-1 overflow-y-auto py-2">
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
        className="flex items-center gap-1.5 py-1 pr-3 text-[13px] text-white/70 transition-colors duration-150 ease-out hover:bg-white/5"
        data-path={node.file.path}
        style={{ paddingLeft: `${12 * depth}px` }}
        onClick={() => onFileClick(node.file!.path)}
      >
        <span className={`w-4 h-4 shrink-0 ${statusColorClass(node.file.status)}`}>
          <Icon name={statusIcon(node.file.status)} />
        </span>
        <span className="flex-1 min-w-0 truncate">{node.name}</span>
        {node.file.status === '?' && (
          <span className={`shrink-0 text-[11px] px-1 py-px rounded font-medium ${badgeColorClass('?')}`}>
            untracked
          </span>
        )}
        {(node.file.additions > 0 || node.file.deletions > 0) && (
          <span className="shrink-0 font-mono text-[13px]">
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
    <div data-expanded={expanded}>
      <div
        className="flex items-center gap-1.5 py-1 pr-3 text-[13px] text-white/50 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white/70"
        style={{ paddingLeft: `${12 * depth}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-3 h-3 shrink-0">
          <Icon name={expanded ? 'caret-down' : 'caret-right'} />
        </span>
        <span className="flex-1 min-w-0 truncate">{node.name}</span>
      </div>
      {expanded && (
        <div>
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

function statusColorClass(status: string): string {
  switch (status) {
    case 'A':
      return 'text-[#34C759]';
    case 'D':
      return 'text-[#FF3B30]';
    case 'R':
      return 'text-[#5856D6]';
    case '?':
      return 'text-[#FF9F0A]';
    default:
      return 'text-white/50';
  }
}

function badgeColorClass(status: string): string {
  switch (status) {
    case 'A':
      return 'bg-[#34C759]/15 text-[#34C759]';
    case 'D':
      return 'bg-[#FF3B30]/15 text-[#FF3B30]';
    case 'R':
      return 'bg-[#5856D6]/15 text-[#5856D6]';
    case '?':
      return 'bg-[#FF9F0A]/15 text-[#FF9F0A]';
    default:
      return 'bg-white/[0.06] text-white/40';
  }
}

// ── Diff file section ────────────────────────────────────────────────

function DiffFileSection({ file, diff }: { file: ChangedFile; diff: FileDiff | null }) {
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
    <div className="border-b border-white/[0.08] last:border-b-0" data-path={file.path}>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-[#252525] border-b border-white/[0.06]">
        <span className="flex-1 min-w-0 truncate text-sm text-white/90" title={file.path}>
          {file.path}
        </span>
        <span className={`shrink-0 text-[11px] px-1 py-px rounded font-medium ${badgeColorClass(file.status)}`}>
          {badgeLabel}
        </span>
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="shrink-0 font-mono text-[13px]">
            {file.additions > 0 && <span className="text-[#69db7c]">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-[#ff6b6b]">-{file.deletions}</span>}
          </span>
        )}
      </div>
      <div>
        {diff === null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">Loading...</div>
        ) : diff.hunks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">
            No diff available
          </div>
        ) : (
          <div className="min-w-full">
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
    <div className="mb-4 last:mb-0">
      <div
        className="py-1 pr-4 bg-[rgba(88,86,214,0.2)] text-[#a0a0ff] font-mono text-xs"
        style={{ paddingLeft: '106px' }}
      >
        {hunk.header}
      </div>
      {hunk.lines.map((line, i) => (
        <DiffLineView key={i} line={line} />
      ))}
    </div>
  );
}

function DiffLineView({ line }: { line: DiffLine }) {
  const lineBg =
    line.type === 'addition'
      ? 'bg-[rgba(52,199,89,0.15)]'
      : line.type === 'deletion'
        ? 'bg-[rgba(255,59,48,0.15)]'
        : '';
  const contentColor =
    line.type === 'addition' ? 'text-[#69db7c]' : line.type === 'deletion' ? 'text-[#ff6b6b]' : 'text-[#e4e4e4]';
  const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';

  return (
    <div className={`flex font-mono text-sm leading-normal ${lineBg}`}>
      <span className="flex shrink-0 select-none sticky left-0 z-[1]">
        <span className="w-[45px] px-2 text-right text-white/25 bg-[#141414] border-r border-white/5">
          {line.oldLineNo ?? ''}
        </span>
        <span className="w-[45px] px-2 text-right text-white/25 bg-[#141414] border-r border-white/5">
          {line.newLineNo ?? ''}
        </span>
      </span>
      <span className={`flex-1 pl-4 pr-12 whitespace-pre-wrap break-words ${contentColor}`}>
        {prefix}
        {line.content}
      </span>
    </div>
  );
}
