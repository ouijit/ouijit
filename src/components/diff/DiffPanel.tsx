import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { FileDiff } from '../../types';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances, refreshTerminalGitStatus } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';
import { DiffFileTree, inTreeOrder } from './DiffFileTree';
import { DiffFileSection } from './DiffFileSection';
import { DeferredMount } from './DeferredMount';
import { scrollToSection, fileSelector } from './scrollToSection';
import { ResizeHandle } from '../common/ResizeHandle';
import { SidebarToggle } from '../common/SidebarToggle';
import { FullWidthToggle, PanelCloseButton } from '../terminal/FullWidthToggle';
import { estimateFileHeight } from './diffMetrics';

interface DiffPanelProps {
  ptyId: string;
  projectPath: string;
  mode: 'uncommitted' | 'worktree';
  /** Filling the terminal body, rather than split beside the terminal. */
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  onClose: () => void;
}

const MAX_DIFF_FILES = 300;
const DEFAULT_SIDEBAR_WIDTH = 220;
const DIFF_BATCH_SIZE = 10;

/**
 * Uncommitted and branch diffs for a terminal's worktree.
 *
 * The file tree, file sections, hunk and line renderers, and the token /
 * word-diff splicing all live in this directory's shared primitives — the same
 * ones the pull request files view renders — so the two can't drift apart.
 */
export function DiffPanel({ ptyId, projectPath, mode, fullWidth, onToggleFullWidth, onClose }: DiffPanelProps) {
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const [diffs, setDiffs] = useState<Map<string, FileDiff | null>>(new Map());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  // Local, and gone when the panel closes: there is no review here to be part
  // way through, only a long diff to get out of your own way.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);

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
  // The tree groups by directory; the document below it has to run in the same
  // order or clicking a file in one is no way to find it in the other.
  const orderedFiles = useMemo(() => inTreeOrder(files), [files]);
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
    scrollToSection(contentRef.current, fileSelector(path));
  }, []);

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
      {!sidebarCollapsed && (
        <div className="shrink-0 overflow-hidden flex flex-col" style={{ width: sidebarWidth }}>
          <DiffFileTree files={files} untrackedFiles={untrackedFiles} onFileClick={scrollToFile} />
        </div>
      )}
      {/* Collapsed there is nothing on the other side of it, and a seam with
          one side is just a line down the edge of the pane. */}
      {!sidebarCollapsed && (
        <ResizeHandle
          width={sidebarWidth}
          onWidth={setSidebarWidth}
          defaultWidth={DEFAULT_SIDEBAR_WIDTH}
          label="Resize the file list"
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Over the well along its whole length — unlike the pull request's
            bar, which spans the rail beside it as well — so the cut is all it
            gets: the near face of a sunken surface is in shadow, and a lit line
            there would be the edge of a raised thing sitting on the boundary
            that was meant to say it is not one. */}
        <div className="pane-ledge over-well relative z-30 px-3 py-2 text-sm text-ink/70 flex items-center gap-2 shrink-0">
          <SidebarToggle
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            hideLabel="Hide the file list"
            showLabel="Show the file list"
          />
          <span
            className="text-xs bg-ink/[0.06] pl-2 pr-1 py-1 text-ink/50 flex items-center gap-1.5 relative"
            style={{ borderRadius: '5px' }}
          >
            {modeLabel}
          </span>
          <span className="text-xs text-text-tertiary ml-auto relative">{stats}</span>
          {/* The same pair every other panel beside a terminal carries, in the
              same order: what the diff is doing is often best read next to what
              is still being done. */}
          <FullWidthToggle fullWidth={fullWidth} onToggle={onToggleFullWidth} />
          <PanelCloseButton onClose={onClose} />
        </div>
        {/* The gap between two cards is what the border between two bands
            used to be. */}
        <div ref={contentRef} className="diff-well diff-list flex-1 overflow-auto pb-3">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">
              Loading changes...
            </div>
          )}
          {!loading && files.length === 0 && untrackedFiles.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">No changes</div>
          )}
          {!loading &&
            orderedFiles.map((file) => (
              // The wrapper carries `data-path` so jumping to a file from the
              // tree works whether or not that file has been mounted yet.
              <DeferredMount
                key={file.path}
                dataPath={file.path}
                estimatedHeight={estimateFileHeight(
                  diffs.get(file.path),
                  file.additions + file.deletions,
                  1,
                  folded.has(file.path),
                )}
              >
                <DiffFileSection
                  path={file.path}
                  status={file.status}
                  additions={file.additions}
                  deletions={file.deletions}
                  diff={diffs.get(file.path)}
                  collapsed={folded.has(file.path)}
                  onCollapsedChange={(next) =>
                    setFolded((prev) => {
                      const copy = new Set(prev);
                      if (next) copy.add(file.path);
                      else copy.delete(file.path);
                      return copy;
                    })
                  }
                />
              </DeferredMount>
            ))}
          {/* A note in the well rather than a band ruled off from the cards:
              the gap either side of it is the boundary. */}
          {!loading && truncated && (
            <div className="mx-6 px-4 py-3 text-xs text-ink/40 text-center">
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
    // The same card the changed files sit in. An untracked file is one of the
    // changes — git simply has nothing to diff it against yet — so it belongs
    // in the list rather than in a band ruled off underneath it.
    <div className="diff-card mx-6 rounded-[14px] border border-bezel bg-diff-card overflow-clip">
      {/* The whole line folds it, as a file's header does, and the caret is on
          the left where every other foldable thing in a diff keeps one. */}
      <button
        type="button"
        aria-expanded={expanded}
        className="pane-ledge w-full flex items-center gap-2 h-9 px-4 bg-terminal-surface text-sm text-ink/50 text-left hover:text-ink/70 hover:bg-ink/5 transition-colors duration-150"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="shrink-0 !w-3 !h-3 text-ink/40" />
        <Icon name="file-plus" className="shrink-0 w-3.5 h-3.5 text-vcs-modified" />
        <span className="min-w-0 flex-1 truncate">
          {files.length} untracked {files.length === 1 ? 'file' : 'files'}
        </span>
      </button>
      {expanded && (
        <div className="py-1">
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
