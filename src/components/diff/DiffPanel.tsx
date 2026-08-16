import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { FileDiff } from '../../types';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances, refreshTerminalGitStatus } from '../terminal/terminalReact';
import { DiffFileTree, inTreeOrder } from './DiffFileTree';
import { DiffFileSection } from './DiffFileSection';
import { DeferredMount } from './DeferredMount';
import { scrollToSection, fileSelector } from './scrollToSection';
import { ResizeHandle } from '../common/ResizeHandle';
import { SidebarToggle } from '../common/SidebarToggle';
import { FullWidthToggle, PanelCloseButton } from '../terminal/FullWidthToggle';
import { estimateFileHeight } from './diffMetrics';
import { useBatchedDiffs } from './useBatchedDiffs';
import { InlineCommentBox, InlineCommentCard } from './InlineCommentBox';
import { DiffNotesIsland } from './DiffNotesIsland';
import { useDiffNotes } from './useDiffNotes';
import { anchorKey, lineTextAt, type DiffLineAnchor } from './diffAnchor';
import { MAX_DIFF_FILES, diffShape, effectiveDiffMode, filesInDiff, usesBranchDiff } from '../../diffSource';
import type { DiffMode } from '../../diffSource';
import { toggleIn } from '../../utils/toggleIn';

interface DiffPanelProps {
  ptyId: string;
  projectPath: string;
  mode: DiffMode;
  /** Filling the terminal body, rather than split beside the terminal. */
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  onClose: () => void;
}

const NOTE_HINT = 'Kept with this worktree until you hand it to the agent.';
const DEFAULT_SIDEBAR_WIDTH = 220;

/**
 * Uncommitted and branch diffs for a terminal's worktree.
 *
 * The file tree, file sections, hunk and line renderers, and the token /
 * word-diff splicing all live in this directory's shared primitives — the same
 * ones the pull request files view renders.
 */
export function DiffPanel({ ptyId, projectPath, mode, fullWidth, onToggleFullWidth, onClose }: DiffPanelProps) {
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const [diffs, setDiffs] = useState<Map<string, FileDiff | null>>(new Map());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  // Local, and gone when the panel closes: folding here is scroll management,
  // not review state that has to survive.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);
  // The loaded diffs, for callbacks that must not be rebuilt each time a batch
  // of them arrives.
  const diffsRef = useRef(diffs);
  diffsRef.current = diffs;

  const instance = terminalInstances.get(ptyId);
  const gitPath = instance?.worktreePath || projectPath;

  // Keyed by worktree, not by panel or terminal session, so notes survive the
  // panel being closed and reopened mid-review.
  const notes = useDiffNotes(gitPath);

  const effectiveMode = useMemo(() => effectiveDiffMode(gitFileStatus, mode), [mode, gitFileStatus]);

  const storeFiles = useMemo(
    () => (gitFileStatus ? filesInDiff(gitFileStatus, effectiveMode) : []),
    [gitFileStatus, effectiveMode],
  );

  const totalFileCount = storeFiles.length;

  // The shape of the change, and the file list held at the same identity for as
  // long as it says the change is the same one.
  //
  // A status poll hands back a fresh object every few seconds whether or not
  // anything moved, and everything below here — the tree walk, the per-file
  // loader — keys off `files`. Without this they all re-run on a diff that did
  // not change.
  // The mode rides along, because it decides which git command each file's
  // diff comes from and two modes can list the same shape — the moment an
  // agent commits, the uncommitted list becomes the branch list unchanged.
  const filesFingerprint = useMemo(
    () => `${effectiveMode}\n${diffShape(storeFiles.slice(0, MAX_DIFF_FILES))}`,
    [storeFiles, effectiveMode],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the fingerprint is the point: it changes only when the list does
  const files = useMemo(() => storeFiles.slice(0, MAX_DIFF_FILES), [filesFingerprint]);
  // The tree groups by directory; the document runs in the same order, or
  // clicking a file in one is no way to find it in the other.
  const ordered = useMemo(() => inTreeOrder(files), [files]);
  const truncated = totalFileCount > MAX_DIFF_FILES;
  const loading = gitFileStatus === null;

  useEffect(() => {
    const inst = terminalInstances.get(ptyId);
    if (inst) refreshTerminalGitStatus(inst);
  }, [ptyId]);

  useBatchedDiffs(
    files,
    filesFingerprint,
    (file) => {
      const branch = usesBranchDiff(effectiveMode, file.status) ? instance?.worktreeBranch : undefined;
      return branch
        ? window.api.worktree.getFileDiff(projectPath, branch, file.path, instance?.mergeTarget)
        : window.api.getFileDiff(gitPath, file.path, undefined, file.status === '?');
    },
    setDiffs,
  );

  const scrollToFile = useCallback((path: string) => {
    scrollToSection(contentRef.current, fileSelector(path));
  }, []);

  const { setComposingAt, setEditingId } = notes;
  const startNote = useCallback(
    (path: string, anchor: DiffLineAnchor) => {
      setEditingId(null);
      setComposingAt({ path, line: anchor.line, side: anchor.side });
    },
    [setComposingAt, setEditingId],
  );

  /**
   * The notes anchored to one line, and the box that writes another.
   *
   * The same slot the pull request's files view fills with threads and drafts,
   * on the same renderer underneath.
   */
  const renderBelowLine = useCallback(
    (path: string, anchor: DiffLineAnchor) => {
      const key = anchorKey(path, anchor.line, anchor.side);
      const here = notes.byAnchor.get(key);
      const composing =
        notes.composingAt?.path === path &&
        notes.composingAt.line === anchor.line &&
        notes.composingAt.side === anchor.side;

      if (!here && !composing) return null;

      // Read when a note is saved rather than on every render: it walks every
      // line of the file, and nothing on screen shows it. Through the ref, so
      // this callback does not have to change identity once per load batch.
      const lineText = () => lineTextAt(diffsRef.current.get(path), anchor);

      return (
        <div className="py-1">
          {here?.map((note) =>
            notes.editingId === note.id ? (
              <InlineCommentBox
                key={note.id}
                initialBody={note.body}
                placeholder="Note for the agent…"
                saveLabel="Update note"
                hint={NOTE_HINT}
                onSave={(body) =>
                  notes.save({ id: note.id, path, line: anchor.line, side: anchor.side, lineText: lineText(), body })
                }
                onCancel={() => notes.setEditingId(null)}
                onDiscard={() => notes.discard(note.id)}
              />
            ) : (
              <InlineCommentCard
                key={note.id}
                label="Note"
                body={note.body}
                onClick={() => notes.setEditingId(note.id)}
              />
            ),
          )}
          {composing && (
            <InlineCommentBox
              placeholder="Note for the agent…"
              saveLabel="Add note"
              hint={NOTE_HINT}
              onSave={(body) => notes.save({ path, line: anchor.line, side: anchor.side, lineText: lineText(), body })}
              onCancel={() => notes.setComposingAt(null)}
            />
          )}
        </div>
      );
    },
    [notes],
  );

  const hasNotes = notes.notes.length > 0 || notes.composingAt !== null;

  const toggleFolded = useCallback((path: string, next: boolean) => {
    setFolded((prev) => toggleIn(prev, path, next));
  }, []);

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

  const renderFile = (file: (typeof files)[number]) => (
    // The wrapper carries `data-path` so jumping to a file from the tree works
    // whether or not that file has been mounted yet.
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
        onAddComment={startNote}
        // Withheld until there is something to draw: it is called once per
        // diff line and changes identity whenever the notes do.
        renderBelowLine={hasNotes ? renderBelowLine : undefined}
        collapsed={folded.has(file.path)}
        onCollapsedChange={toggleFolded}
      />
    </DeferredMount>
  );

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--color-terminal-bg)' }}>
      {!sidebarCollapsed && (
        <div className="shrink-0 overflow-hidden flex flex-col" style={{ width: sidebarWidth }}>
          <DiffFileTree files={files} onFileClick={scrollToFile} />
        </div>
      )}
      {/* Collapsed there is nothing on its left, so the seam divides nothing. */}
      {!sidebarCollapsed && (
        <ResizeHandle
          width={sidebarWidth}
          onWidth={setSidebarWidth}
          defaultWidth={DEFAULT_SIDEBAR_WIDTH}
          label="Resize the file list"
        />
      )}
      {/* Positioned so the notes island floats over the foot of this column,
          over the diff rather than over the file rail beside it. */}
      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Spans the well only, unlike the pull request's bar, which covers the
            rail beside it as well. */}
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
          <FullWidthToggle fullWidth={fullWidth} onToggle={onToggleFullWidth} />
          <PanelCloseButton onClose={onClose} />
        </div>
        {/* Extra padding at the foot while the island is showing, so the last
            card scrolls clear of it rather than ending behind it. */}
        <div
          ref={contentRef}
          className={`diff-well diff-list flex-1 overflow-auto ${notes.notes.length > 0 ? 'pb-16' : 'pb-3'}`}
        >
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">
              Loading changes...
            </div>
          )}
          {!loading && files.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">No changes</div>
          )}
          {!loading && ordered.map((file) => renderFile(file))}

          {!loading && truncated && (
            <div className="mx-6 px-4 py-3 text-xs text-ink/40 text-center">
              Showing {files.length} of {totalFileCount} changed files
            </div>
          )}
        </div>
        <DiffNotesIsland
          notes={notes.notes}
          mode={effectiveMode}
          ptyId={ptyId}
          onJump={(note) => scrollToFile(note.path)}
          onDiscard={notes.discard}
          onClear={notes.clear}
        />
      </div>
    </div>
  );
}
