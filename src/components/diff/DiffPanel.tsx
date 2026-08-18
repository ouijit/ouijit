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
import { DiffComparisonPicker } from './DiffComparisonPicker';
import { useDiffNotes } from './useDiffNotes';
import { anchorKey, anchorStart, blockAt, composingAt, describeAnchor, type DiffLineAnchor } from '../../diffAnchor';
import { MAX_DIFF_FILES, diffShape, diffSubject, filesInDiff } from '../../diffSource';
import { toggleIn } from '../../utils/toggleIn';

interface DiffPanelProps {
  ptyId: string;
  projectPath: string;
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
export function DiffPanel({ ptyId, projectPath, fullWidth, onToggleFullWidth, onClose }: DiffPanelProps) {
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

  // Both from the status rather than from the terminal's request, so the label
  // and the list can never name different comparisons: this is the base the
  // answer on screen was actually produced against.
  const base = gitFileStatus?.base ?? null;
  const branch = gitFileStatus?.branch ?? null;

  const storeFiles = useMemo(() => (gitFileStatus ? filesInDiff(gitFileStatus) : []), [gitFileStatus]);

  const totalFileCount = storeFiles.length;

  // The shape of the change, and the file list held at the same identity for as
  // long as it says the change is the same one.
  //
  // A status poll hands back a fresh object every few seconds whether or not
  // anything moved, and everything below here — the tree walk, the per-file
  // loader — keys off `files`. Without this they all re-run on a diff that did
  // not change.
  // The base rides along, because two comparisons can list the same shape and
  // the hunks under it still differ — a branch level with its remote lists the
  // same files either way it is read.
  const filesFingerprint = useMemo(
    () => `${base ?? ''}\n${diffShape(storeFiles.slice(0, MAX_DIFF_FILES))}`,
    [storeFiles, base],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the fingerprint is the point: it changes only when the list does
  const files = useMemo(() => storeFiles.slice(0, MAX_DIFF_FILES), [filesFingerprint]);
  // The tree groups by directory; the document runs in the same order, or
  // clicking a file in one is no way to find it in the other.
  const ordered = useMemo(() => inTreeOrder(files), [files]);
  const truncated = totalFileCount > MAX_DIFF_FILES;
  const loading = gitFileStatus === null;

  // Keyed by worktree, not by panel or terminal session, so notes survive the
  // panel being closed and reopened mid-review.
  const notes = useDiffNotes(gitPath, filesFingerprint);

  useEffect(() => {
    const inst = terminalInstances.get(ptyId);
    if (inst) refreshTerminalGitStatus(inst);
  }, [ptyId]);

  useBatchedDiffs(
    files,
    filesFingerprint,
    (file) => {
      // An untracked file is in no revision, so no comparison can produce it —
      // it is read whole, as the addition it would be.
      return file.status === '?' || !base
        ? window.api.getFileDiff(gitPath, file.path, undefined, file.status === '?')
        : window.api.worktree.getFileDiff(gitPath, base, file.path, file.oldPath);
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
      setComposingAt({ path, ...anchor });
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
      const composing = composingAt(notes.composingAt, path, anchor);

      if (!here && !composing) return null;

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
                onSave={(body) => notes.save({ id: note.id, path, line: note.line, side: note.side, body })}
                onCancel={() => notes.setEditingId(null)}
                onDiscard={() => notes.discard(note.id)}
              />
            ) : (
              <InlineCommentCard
                key={note.id}
                label={`Note · ${describeAnchor(note)}`}
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
              // The snippet is read here, once, rather than on every render: it
              // walks the file, and nothing on screen shows it. Through the ref
              // so this callback survives a batch of diffs arriving.
              onSave={(body) =>
                notes.save({
                  path,
                  line: composing.line,
                  startLine: composing.startLine,
                  side: composing.side,
                  snippet: blockAt(diffsRef.current.get(path), composing),
                  body,
                })
              }
              onCancel={() => notes.setComposingAt(null)}
            />
          )}
        </div>
      );
    },
    [notes],
  );

  const hasNotes = notes.notes.length > 0 || notes.composingAt !== null;

  // Which lines a comment covers without rendering on them: the range being
  // written, and every saved range. Single lines are left out — the box sits
  // directly under the line it is about, which says it already.
  const spans = useMemo(() => {
    const saved = notes.notes.filter((note) => note.startLine !== note.line);
    const at = notes.composingAt;
    return at && anchorStart(at) !== at.line ? [...saved, at] : saved;
  }, [notes.notes, notes.composingAt]);

  const markLine = useCallback(
    (path: string, anchor: DiffLineAnchor) =>
      spans.some(
        (span) =>
          span.path === path &&
          span.side === anchor.side &&
          anchor.line >= anchorStart(span) &&
          anchor.line <= span.line,
      ),
    [spans],
  );

  // A note is on screen when the diff being shown carries the lines it is
  // about. Not merely when its file is listed: a note can sit on a line this
  // comparison leaves outside every hunk.
  const inView = useMemo(
    () => new Set(notes.notes.filter((note) => blockAt(diffs.get(note.path), note) !== null).map((note) => note.id)),
    [notes.notes, diffs],
  );

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
        markLine={spans.length > 0 ? markLine : undefined}
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
          <DiffComparisonPicker
            ptyId={ptyId}
            gitPath={gitPath}
            base={base}
            defaultBase={instance?.mergeTarget ?? gitFileStatus?.mainBranch ?? null}
            mainBranch={gitFileStatus?.mainBranch ?? null}
            branch={branch}
          />
          {/* `min-w-0` is what lets it shrink at all — a flex item will not go
              below its content without it, and this one would rather wrap to
              three lines than give way. Nothing recovers what the cut takes:
              the same counts are on the terminal's own diff button. */}
          <span className="ml-auto min-w-0 truncate text-xs text-text-tertiary">{stats}</span>
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
          inView={inView}
          subject={diffSubject(base, branch)}
          ptyId={ptyId}
          onJump={(note) => scrollToFile(note.path)}
          onDiscard={notes.discard}
          onClear={notes.clear}
        />
      </div>
    </div>
  );
}
