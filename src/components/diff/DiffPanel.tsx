import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { FileDiff } from '../../types';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances, refreshTerminalGitStatus } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';
import { DiffFileTree } from './DiffFileTree';
import { DiffFileSection } from './DiffFileSection';

interface DiffPanelProps {
  ptyId: string;
  projectPath: string;
  mode: 'uncommitted' | 'worktree';
  onClose: () => void;
}

const MAX_DIFF_FILES = 300;
const DIFF_BATCH_SIZE = 10;

/**
 * Uncommitted and branch diffs for a terminal's worktree.
 *
 * The file tree, file sections, hunk and line renderers, and the token /
 * word-diff splicing all live in this directory's shared primitives — the same
 * ones the pull request files view renders — so the two can't drift apart.
 */
export function DiffPanel({ ptyId, projectPath, mode, onClose }: DiffPanelProps) {
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

  // Load per-file diffs in batches when the file list changes.
  // Within each batch we mutate a single Map and call setDiffs once with a
  // fresh clone — previously each finished file cloned the entire map
  // (O(N) per file → O(N²) for the whole load). With ~300 files that was
  // tens of thousands of redundant copies during the load.
  useEffect(() => {
    let cancelled = false;
    setDiffs(new Map());

    if (files.length === 0) return;

    const accumulated = new Map<string, FileDiff | null>();

    const loadDiffs = async () => {
      for (let i = 0; i < files.length; i += DIFF_BATCH_SIZE) {
        if (cancelled) return;
        const batch = files.slice(i, i + DIFF_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (file): Promise<[string, FileDiff | null]> => {
            try {
              const diff =
                effectiveMode === 'worktree' && instance?.worktreeBranch
                  ? await window.api.worktree.getFileDiff(
                      projectPath,
                      instance.worktreeBranch,
                      file.path,
                      instance.mergeTarget,
                    )
                  : await window.api.getFileDiff(gitPath, file.path);
              return [file.path, diff];
            } catch {
              return [file.path, null];
            }
          }),
        );
        if (cancelled) return;
        for (const [path, diff] of results) accumulated.set(path, diff);
        // One copy per batch instead of one per file — batches of 10 means
        // ~30 copies for 300 files instead of ~45 000.
        setDiffs(new Map(accumulated));
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
    <div className="flex flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--color-terminal-bg)' }}>
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
          className="w-[3px] shrink-0 bg-ink/10 hover:bg-accent/60 active:bg-accent transition-colors duration-100"
          style={{ cursor: 'col-resize' }}
          onMouseDown={handleSidebarDragStart}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="px-3 py-2 text-sm text-ink/70 flex items-center gap-2 shrink-0">
          <button
            className="w-7 h-7 rounded-md bg-transparent border-none text-ink/60 flex items-center justify-center shrink-0 transition-all duration-150 ease-out hover:bg-ink/10 hover:text-ink/90"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <Icon name={sidebarCollapsed ? 'caret-right' : 'caret-left'} />
          </button>
          <span
            className="text-xs bg-ink/[0.06] pl-2 pr-1 py-1 text-ink/50 flex items-center gap-1.5 relative"
            style={{ borderRadius: '5px' }}
          >
            {modeLabel}
          </span>
          <span className="text-xs text-text-tertiary ml-auto relative">{stats}</span>
          <button
            className="w-7 h-7 rounded-md bg-transparent border-none text-ink/60 flex items-center justify-center shrink-0 transition-all duration-150 ease-out hover:bg-ink/10 hover:text-ink/90 [&>svg]:w-4 [&>svg]:h-4"
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
            files.map((file) => (
              <DiffFileSection
                key={file.path}
                path={file.path}
                status={file.status}
                additions={file.additions}
                deletions={file.deletions}
                diff={diffs.get(file.path) ?? null}
              />
            ))}
          {!loading && truncated && (
            <div className="px-4 py-3 text-xs text-ink/40 text-center border-t border-ink/[0.06]">
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
    <div className="border-t border-ink/[0.08]">
      <div
        className="flex items-center gap-2 px-4 py-2 bg-terminal-surface border-b border-ink/[0.06] text-sm text-ink/50 hover:text-ink/70 transition-colors duration-150"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="!w-3 !h-3" />
        <Icon name="file-plus" className="w-3.5 h-3.5 text-vcs-modified" />
        <span>
          {files.length} untracked {files.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      {expanded && (
        <div className="bg-terminal-surface-alt">
          {files.map((filePath) => (
            <div key={filePath} className="flex items-center gap-2 px-4 py-1 text-sm text-ink/50 font-mono">
              <span className="truncate">{filePath}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
