import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { ChangedFile, FileDiff, DiffHunk, DiffLine } from '../../types';
import type { ThemedToken, HunkTokens } from '../../utils/syntaxHighlight';
import type { WordHighlight } from '../../utils/wordDiff';
import { computeWordHighlights } from '../../utils/wordDiff';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances, refreshTerminalGitStatus } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';
import { useSyntaxHighlight } from './useSyntaxHighlight';

interface DiffPanelProps {
  ptyId: string;
  projectPath: string;
  onClose: () => void;
}

const MAX_DIFF_FILES = 300;
const DIFF_BATCH_SIZE = 10;

export function DiffPanel({ ptyId, projectPath, onClose }: DiffPanelProps) {
  const mode = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelMode ?? 'uncommitted');
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const [diffs, setDiffs] = useState<Map<string, FileDiff | null>>(new Map());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const contentRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const instance = terminalInstances.get(ptyId);
  const gitPath = instance?.worktreePath || projectPath;

  // Derive effective mode to match the GitStats button logic:
  // the button shows uncommitted changes when they exist, falling back to branch diff.
  // The panel must follow the same logic so they always agree.
  const effectiveMode = useMemo(() => {
    if (mode !== 'worktree' || !gitFileStatus) return mode;
    return gitFileStatus.uncommittedFiles.length > 0 ? 'uncommitted' : 'worktree';
  }, [mode, gitFileStatus]);

  // Derive file list from the store (same data the GitStats button uses)
  const storeFiles = useMemo(() => {
    if (!gitFileStatus) return [];
    return effectiveMode === 'worktree' ? gitFileStatus.branchDiffFiles : gitFileStatus.uncommittedFiles;
  }, [gitFileStatus, effectiveMode]);

  const totalFileCount = storeFiles.length;
  const files = useMemo(() => storeFiles.slice(0, MAX_DIFF_FILES), [storeFiles]);
  const truncated = totalFileCount > MAX_DIFF_FILES;
  const loading = gitFileStatus === null;
  const untrackedFiles = gitFileStatus?.untrackedFiles ?? [];

  // Stable fingerprint — only changes when the actual file list changes.
  // Prevents hunk-loading from restarting on no-op 3s git status refreshes.
  const filesFingerprint = useMemo(
    () => files.map((f) => `${f.status}:${f.path}:${f.additions}:${f.deletions}`).join('\n'),
    [files],
  );

  // Trigger an immediate git status refresh when panel opens for fresh data
  useEffect(() => {
    const inst = terminalInstances.get(ptyId);
    if (inst) refreshTerminalGitStatus(inst);
  }, [ptyId]);

  // Load per-file diffs in batches when the file list changes
  useEffect(() => {
    let cancelled = false;
    setDiffs(new Map());

    if (files.length === 0) return;

    const loadDiffs = async () => {
      for (let i = 0; i < files.length; i += DIFF_BATCH_SIZE) {
        if (cancelled) return;
        const batch = files.slice(i, i + DIFF_BATCH_SIZE);
        await Promise.all(
          batch.map(async (file) => {
            try {
              let diff: FileDiff | null;
              if (effectiveMode === 'worktree' && instance?.worktreeBranch) {
                diff = await window.api.worktree.getFileDiff(
                  projectPath,
                  instance.worktreeBranch,
                  file.path,
                  instance.mergeTarget,
                );
              } else {
                diff = await window.api.getFileDiff(gitPath, file.path);
              }
              if (!cancelled) {
                setDiffs((prev) => new Map(prev).set(file.path, diff));
              }
            } catch {
              if (!cancelled) {
                setDiffs((prev) => new Map(prev).set(file.path, null));
              }
            }
          }),
        );
      }
    };

    loadDiffs();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filesFingerprint is the stable proxy for files
  }, [filesFingerprint, effectiveMode, gitPath, projectPath, instance?.worktreeBranch]);

  const scrollToFile = useCallback((path: string) => {
    const section = contentRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSidebarDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.max(120, Math.min(500, startWidth + ev.clientX - startX));
        setSidebarWidth(newWidth);
      };
      const onMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [sidebarWidth],
  );

  // Header stats
  const stats = useMemo(() => {
    const displayed = files.length;
    const untracked = files.filter((f) => f.status === '?').length;
    const additions = files.reduce((s, f) => s + f.additions, 0);
    const deletions = files.reduce((s, f) => s + f.deletions, 0);

    let text = truncated ? `${displayed} of ${totalFileCount} files` : `${displayed} file${displayed !== 1 ? 's' : ''}`;
    if (untracked > 0) text += ` (${untracked} untracked)`;
    if (additions > 0) text += ` +${additions}`;
    if (deletions > 0) text += ` -${deletions}`;
    return text;
  }, [files, truncated, totalFileCount]);

  const modeLabel = effectiveMode === 'worktree' ? 'Branch changes' : 'Uncommitted changes';

  return (
    <div
      className="absolute inset-0 rounded-none border-0 border-t border-solid border-white/10 shadow-none z-20 flex overflow-hidden opacity-100 pointer-events-auto"
      style={{ background: 'var(--color-terminal-bg, #171717)', transition: 'opacity 0.15s ease' }}
    >
      <div
        className={
          sidebarCollapsed
            ? 'w-0 overflow-hidden border-r-0 shrink-0 flex flex-col'
            : 'shrink-0 overflow-hidden flex flex-col'
        }
        style={sidebarCollapsed ? { transition: 'width 0.2s ease' } : { width: sidebarWidth }}
      >
        <DiffFileTree files={files} untrackedFiles={untrackedFiles} onFileClick={scrollToFile} />
      </div>
      {!sidebarCollapsed && (
        <div
          className="w-[3px] shrink-0 bg-white/10 hover:bg-accent/60 active:bg-accent transition-colors duration-100"
          style={{ cursor: 'col-resize' }}
          onMouseDown={handleSidebarDragStart}
        />
      )}
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
          {!loading && files.length === 0 && untrackedFiles.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">No changes</div>
          )}
          {!loading &&
            files.map((file) => <DiffFileSection key={file.path} file={file} diff={diffs.get(file.path) ?? null} />)}
          {!loading && truncated && (
            <div className="px-4 py-3 text-xs text-white/40 text-center border-t border-white/[0.06]">
              Showing {files.length} of {totalFileCount} changed files
            </div>
          )}
          {!loading && untrackedFiles.length > 0 && <UntrackedFilesSection files={untrackedFiles} />}
        </div>
      </div>
    </div>
  );
}

// ── Untracked files section ──────────────────────────────────────────

function UntrackedFilesSection({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-white/[0.08]">
      <div
        className="flex items-center gap-2 px-4 py-2 bg-[#252525] border-b border-white/[0.06] text-sm text-white/50 hover:text-white/70 transition-colors duration-150"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="!w-3 !h-3" />
        <Icon name="file-plus" className="w-3.5 h-3.5 text-[#FF9F0A]" />
        <span>
          {files.length} untracked {files.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      {expanded && (
        <div className="bg-[#1a1a1a]">
          {files.map((filePath) => (
            <div key={filePath} className="flex items-center gap-2 px-4 py-1 text-sm text-white/50 font-mono">
              <span className="truncate">{filePath}</span>
            </div>
          ))}
        </div>
      )}
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

function DiffFileTree({
  files,
  untrackedFiles,
  onFileClick,
}: {
  files: ChangedFile[];
  untrackedFiles: string[];
  onFileClick: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [untrackedExpanded, setUntrackedExpanded] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {tree.map((node) => (
        <TreeNodeView key={node.fullPath} node={node} onFileClick={onFileClick} />
      ))}
      {untrackedFiles.length > 0 && (
        <>
          <div
            className="flex items-center gap-1.5 py-1 pl-3 pr-3 mt-1 border-t border-white/[0.06] text-[13px] text-white/40 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white/60"
            onClick={() => setUntrackedExpanded(!untrackedExpanded)}
          >
            <Icon name={untrackedExpanded ? 'caret-down' : 'caret-right'} className="!w-3 !h-3" />
            <span>{untrackedFiles.length} untracked</span>
          </div>
          {untrackedExpanded &&
            untrackedFiles.map((filePath) => (
              <div key={filePath} className="flex items-center gap-1.5 py-1 pl-6 pr-3 text-[13px] text-white/40">
                <Icon name="file-plus" className="w-4 h-4 text-[#FF9F0A]" />
                <span className="flex-1 min-w-0 truncate">{filePath}</span>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

function TreeNodeView({ node, onFileClick }: { node: TreeNode; onFileClick: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true);

  if (node.isFile && node.file) {
    return (
      <div
        className="flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] text-white/70 transition-colors duration-150 ease-out hover:bg-white/5"
        data-path={node.file.path}
        onClick={() => onFileClick(node.file!.path)}
      >
        <Icon name={statusIcon(node.file.status)} className={`w-4 h-4 ${statusColorClass(node.file.status)}`} />
        <span className="flex-1 min-w-0 truncate">{node.name}</span>
        {node.file.status === '?' && (
          <span className={`shrink-0 text-[11px] px-1 py-px rounded font-medium ${badgeColorClass('?')}`}>
            untracked
          </span>
        )}
        {(node.file.additions > 0 || node.file.deletions > 0) && (
          <span className="shrink-0 font-mono text-[13px]">
            {node.file.additions > 0 && <span className="text-[#3fb950]">+{node.file.additions}</span>}
            {node.file.additions > 0 && node.file.deletions > 0 && ' '}
            {node.file.deletions > 0 && <span className="text-[#f85149]">-{node.file.deletions}</span>}
          </span>
        )}
      </div>
    );
  }

  // Directory node
  return (
    <div data-expanded={expanded}>
      <div
        className="flex items-center gap-1.5 py-1 pl-3 pr-3 text-[13px] text-white/50 transition-colors duration-150 ease-out hover:bg-white/5 hover:text-white/70"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="!w-3 !h-3" />
        <span className="flex-1 min-w-0 truncate">{node.name}</span>
      </div>
      {expanded && (
        <div className="pl-3">
          {sortTreeNodes(node.children).map((child) => (
            <TreeNodeView key={child.fullPath} node={child} onFileClick={onFileClick} />
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
  const tokens = useSyntaxHighlight(diff, file.path);

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
            {file.additions > 0 && <span className="text-[#3fb950]">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-[#f85149]">-{file.deletions}</span>}
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
              <div key={i}>
                <HunkHeader header={hunk.header} />
                <DiffHunkView hunk={hunk} hunkTokens={tokens?.[i] ?? null} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HunkHeader({ header }: { header: string }) {
  return (
    <div
      className="py-1 pr-4 bg-[rgba(88,86,214,0.10)] text-[#8b8bcd] font-mono text-xs truncate"
      style={{ paddingLeft: '106px' }}
    >
      {header}
    </div>
  );
}

function DiffHunkView({ hunk, hunkTokens }: { hunk: DiffHunk; hunkTokens: HunkTokens | null }) {
  const wordHighlights = useMemo(() => computeWordHighlights(hunk.lines), [hunk.lines]);

  return (
    <div>
      {hunk.lines.map((line, i) => (
        <DiffLineView key={i} line={line} tokens={hunkTokens?.[i] ?? null} wordHighlight={wordHighlights.get(i)} />
      ))}
    </div>
  );
}

function DiffLineView({
  line,
  tokens,
  wordHighlight,
}: {
  line: DiffLine;
  tokens: ThemedToken[] | null;
  wordHighlight?: WordHighlight;
}) {
  const lineBg =
    line.type === 'addition'
      ? 'bg-[rgba(63,185,80,0.10)]'
      : line.type === 'deletion'
        ? 'bg-[rgba(248,81,73,0.08)]'
        : '';
  const gutterBg =
    line.type === 'addition'
      ? 'bg-[rgba(63,185,80,0.12)]'
      : line.type === 'deletion'
        ? 'bg-[rgba(248,81,73,0.10)]'
        : 'bg-[#141414]';
  const prefixColor =
    line.type === 'addition' ? 'text-[#3fb950]' : line.type === 'deletion' ? 'text-[#f85149]' : 'text-transparent';
  const wordBg =
    line.type === 'addition' ? 'rgba(63,185,80,0.25)' : line.type === 'deletion' ? 'rgba(248,81,73,0.22)' : undefined;

  return (
    <div className={`flex font-mono text-sm leading-normal ${lineBg}`}>
      <span className="flex shrink-0 select-none sticky left-0 z-[1]">
        <span className={`w-[45px] px-2 text-right text-white/25 ${gutterBg} border-r border-white/5`}>
          {line.oldLineNo ?? ''}
        </span>
        <span className={`w-[45px] px-2 text-right text-white/25 ${gutterBg} border-r border-white/5`}>
          {line.newLineNo ?? ''}
        </span>
      </span>
      <span className="flex-1 pl-2 pr-12 whitespace-pre-wrap break-words">
        <span className={`inline-block w-4 select-none ${prefixColor}`}>
          {line.type === 'context' ? ' ' : line.type === 'addition' ? '+' : '-'}
        </span>
        {tokens
          ? renderTokensWithHighlights(tokens, wordHighlight, wordBg)
          : renderPlainWithHighlights(line.content, wordHighlight, wordBg)}
      </span>
    </div>
  );
}

/** Render syntax tokens, splitting them at word-highlight boundaries */
function renderTokensWithHighlights(
  tokens: ThemedToken[],
  wordHighlight: WordHighlight | undefined,
  wordBg: string | undefined,
): React.ReactNode[] {
  if (!wordHighlight || wordHighlight.ranges.length === 0 || !wordBg) {
    return tokens.map((token, i) => (
      <span key={i} style={token.color ? { color: token.color } : undefined}>
        {token.content}
      </span>
    ));
  }

  const elements: React.ReactNode[] = [];
  let charPos = 0;
  let rangeIdx = 0;
  const ranges = wordHighlight.ranges;

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti];
    const tokenStart = charPos;
    const tokenEnd = charPos + token.content.length;
    const baseStyle: React.CSSProperties = token.color ? { color: token.color } : {};

    // Check if this token overlaps any highlight range
    let hasOverlap = false;
    for (let r = rangeIdx; r < ranges.length && ranges[r][0] < tokenEnd; r++) {
      if (ranges[r][1] > tokenStart) {
        hasOverlap = true;
        break;
      }
    }

    if (!hasOverlap) {
      elements.push(
        <span key={`${ti}`} style={baseStyle}>
          {token.content}
        </span>,
      );
    } else {
      // Split token at highlight boundaries
      let pos = 0;
      let partIdx = 0;
      while (pos < token.content.length) {
        const absPos = tokenStart + pos;
        // Find the next relevant range
        while (rangeIdx < ranges.length && ranges[rangeIdx][1] <= absPos) rangeIdx++;

        if (rangeIdx < ranges.length && ranges[rangeIdx][0] <= absPos) {
          // Inside a highlight range
          const end = Math.min(token.content.length, ranges[rangeIdx][1] - tokenStart);
          elements.push(
            <span key={`${ti}-${partIdx++}`} style={{ ...baseStyle, backgroundColor: wordBg, borderRadius: '2px' }}>
              {token.content.slice(pos, end)}
            </span>,
          );
          pos = end;
        } else {
          // Before the next highlight range
          const nextRangeStart = rangeIdx < ranges.length ? ranges[rangeIdx][0] - tokenStart : token.content.length;
          const end = Math.min(token.content.length, nextRangeStart);
          elements.push(
            <span key={`${ti}-${partIdx++}`} style={baseStyle}>
              {token.content.slice(pos, end)}
            </span>,
          );
          pos = end;
        }
      }
    }

    charPos = tokenEnd;
  }

  return elements;
}

/** Render plain text content with word-highlight backgrounds */
function renderPlainWithHighlights(
  content: string,
  wordHighlight: WordHighlight | undefined,
  wordBg: string | undefined,
): React.ReactNode {
  if (!wordHighlight || wordHighlight.ranges.length === 0 || !wordBg) {
    return <span className="text-[#e6edf3]">{content}</span>;
  }

  const elements: React.ReactNode[] = [];
  let pos = 0;

  for (const [start, end] of wordHighlight.ranges) {
    if (start > pos) {
      elements.push(
        <span key={pos} className="text-[#e6edf3]">
          {content.slice(pos, start)}
        </span>,
      );
    }
    elements.push(
      <span key={start} className="text-[#e6edf3]" style={{ backgroundColor: wordBg, borderRadius: '2px' }}>
        {content.slice(start, end)}
      </span>,
    );
    pos = end;
  }

  if (pos < content.length) {
    elements.push(
      <span key={pos} className="text-[#e6edf3]">
        {content.slice(pos)}
      </span>,
    );
  }

  return elements;
}
