import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { ChangedFile, FileDiff } from '../../types';
import { useTerminalStore } from '../../stores/terminalStore';
import {
  useUIStore,
  DIFF_FILE_LIST_DEFAULT_WIDTH,
  DIFF_FILE_LIST_MIN_WIDTH,
  DIFF_FILE_LIST_MAX_WIDTH,
} from '../../stores/uiStore';
import { terminalInstances, refreshTerminalGitStatus } from '../terminal/terminalReact';
import { DiffFileTree, treeFileOrder } from './DiffFileTree';
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
import { useDiffLens } from './useDiffLens';
import { LensPicker } from './LensPicker';
import { LensedFileList } from './LensedFileList';
import { LensDialog } from '../dialogs/LensDialog';
import { anchorKey, anchorStart, blockAt, composingAt, describeAnchor, type DiffLineAnchor } from '../../diffAnchor';
import { MAX_DIFF_FILES, diffShape, diffSubject, filesInDiff } from '../../diffSource';
import type { DiffLensTarget } from '../../lens/worktreeSubject';
import { toggleIn } from '../../utils/toggleIn';
import { useAnalysisSignals } from '../../hooks/useAnalysisSignals';
import { AnalysisChip, AnalysisRailDot, worthAChip } from './AnalysisChip';

interface DiffPanelProps {
  ptyId: string;
  projectPath: string;
  /** Fills the terminal body instead of splitting beside the terminal. */
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  onClose: () => void;
}

const NOTE_HINT = 'Kept with this worktree until you hand it to the agent.';

/** Uncommitted and branch diffs for a terminal's worktree. */
export function DiffPanel({ ptyId, projectPath, fullWidth, onToggleFullWidth, onClose }: DiffPanelProps) {
  const gitFileStatus = useTerminalStore((s) => s.displayStates[ptyId]?.gitFileStatus ?? null);
  const [diffs, setDiffs] = useState<Map<string, FileDiff | null>>(new Map());
  const sidebarCollapsed = useUIStore((s) => s.diffFileListCollapsed);
  const sidebarWidth = useUIStore((s) => s.diffFileListWidth);
  // Local, and gone when the panel closes: folding here is scroll management,
  // not review state that has to survive.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);
  // Through a ref so callbacks survive each batch of diffs arriving.
  const diffsRef = useRef(diffs);
  diffsRef.current = diffs;

  const instance = terminalInstances.get(ptyId);
  const gitPath = instance?.worktreePath || projectPath;

  // From the status, not the terminal's request: this is the base the files on
  // screen were actually produced against.
  const base = gitFileStatus?.base ?? null;
  const branch = gitFileStatus?.branch ?? null;

  const storeFiles = useMemo(() => (gitFileStatus ? filesInDiff(gitFileStatus) : []), [gitFileStatus]);

  const totalFileCount = storeFiles.length;

  // Status polls hand back a fresh object every few seconds, so the tree walk,
  // the lens resolution and the per-file loader below key off this fingerprint
  // instead. The base is part of it: two comparisons can list the same files
  // with different hunks.
  const filesFingerprint = useMemo(
    () => `${base ?? ''}\n${diffShape(storeFiles.slice(0, MAX_DIFF_FILES))}`,
    [storeFiles, base],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the fingerprint is the point: it changes only when the list does
  const files = useMemo(() => storeFiles.slice(0, MAX_DIFF_FILES), [filesFingerprint]);
  // The order a lens's groups are sorted into. `LensedFileList` runs the
  // document in the same one, so the two never disagree about where a file sits.
  const order = useMemo(() => treeFileOrder(files), [files]);
  const truncated = totalFileCount > MAX_DIFF_FILES;
  const loading = gitFileStatus === null;

  // Keyed by worktree, not by panel or session, so notes survive the panel
  // being closed and reopened mid-review.
  const notes = useDiffNotes(gitPath, filesFingerprint);

  // Against the project repo, not the worktree: the history is shared, and
  // diff paths are repo-relative either way.
  const analysisPaths = useMemo(() => files.map((f) => f.path), [files]);
  const analysisSignals = useAnalysisSignals(projectPath, filesFingerprint, analysisPaths);

  // Elements held in a map so their identity survives re-renders — a fresh
  // element per render would defeat every DiffFileSection's memo.
  const analysisChips = useMemo(() => {
    if (!analysisSignals) return null;
    const chips = new Map<string, ReactNode>();
    for (const [path, analysis] of Object.entries(analysisSignals)) {
      if (worthAChip(analysis)) chips.set(path, <AnalysisChip {...analysis} />);
    }
    return chips;
  }, [analysisSignals]);

  const railTrailing = useCallback(
    (file: ChangedFile) => <AnalysisRailDot signal={analysisSignals?.[file.path]?.signal} />,
    [analysisSignals],
  );

  // What a lens over this diff is written against. Null only when there is no
  // path to key one to.
  const lensTarget = useMemo<DiffLensTarget | null>(
    () =>
      gitPath
        ? {
            projectPath,
            worktreePath: gitPath,
            base,
            branch,
            mergeTarget: instance?.mergeTarget,
            title: instance?.label,
            description: instance?.taskPrompt,
          }
        : null,
    [gitPath, projectPath, base, branch, instance?.mergeTarget, instance?.label, instance?.taskPrompt],
  );

  useEffect(() => {
    const inst = terminalInstances.get(ptyId);
    if (inst) refreshTerminalGitStatus(inst);
  }, [ptyId]);

  useBatchedDiffs(
    files,
    filesFingerprint,
    (file) => {
      // An untracked file is in no revision, so no comparison can produce it;
      // read it whole instead.
      return file.status === '?' || !base
        ? window.api.getFileDiff(gitPath, file.path, undefined, file.status === '?')
        : window.api.worktree.getFileDiff(gitPath, base, file.path, file.oldPath);
    },
    setDiffs,
  );

  const lens = useDiffLens(lensTarget, diffs, order);
  const [lensesOpen, setLensesOpen] = useState(false);

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
              // The snippet is read on save, not per render: it walks the file
              // and nothing displays it.
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

  // Multi-line ranges only: a single-line note renders directly under its line,
  // so marking it says nothing extra.
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

  // Listing a note's file is not enough: it can sit on a line this comparison
  // leaves outside every hunk.
  const inView = useMemo(
    () => new Set(notes.notes.filter((note) => blockAt(diffs.get(note.path), note) !== null).map((note) => note.id)),
    [notes.notes, diffs],
  );

  const toggleFolded = useCallback((path: string, next: boolean) => {
    setFolded((prev) => toggleIn(prev, path, next));
  }, []);

  const { setCollapsed } = lens;
  const toggleGroup = useCallback(
    (title: string, next: boolean) => {
      setCollapsed((prev) => toggleIn(prev, title, next));
    },
    [setCollapsed],
  );

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

  // The key is the caller's to give: a lens can name the same file in more than
  // one part, and React would otherwise keep only the second copy.
  const renderFile = (file: (typeof files)[number], key?: string, hunks?: number[]) => (
    // `data-path` on the wrapper, so the tree can jump to a file that has not
    // mounted yet.
    <DeferredMount
      key={key ?? file.path}
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
        diff={lens.sliceFor(file.path, diffs.get(file.path), hunks)}
        onAddComment={startNote}
        // Withheld until there is something to draw: it runs once per diff line
        // and changes identity whenever the notes do.
        renderBelowLine={hasNotes ? renderBelowLine : undefined}
        markLine={spans.length > 0 ? markLine : undefined}
        headerRight={analysisChips?.get(file.path)}
        collapsed={folded.has(file.path)}
        onCollapsedChange={toggleFolded}
      />
    </DeferredMount>
  );

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--color-terminal-bg)' }}>
      {!sidebarCollapsed && (
        <div className="shrink-0 overflow-hidden flex flex-col" style={{ width: sidebarWidth }}>
          {/* Above the list it reorders and outside its scroll, where the pull
              request rail keeps its own. "All files" is one of the options, so
              the file list and the lenses are a single choice.

              `h-11` is the toolbar across the seam — `py-2` around an `h-7`
              control — so the rule under the two ledges is one line. */}
          {lensTarget && (
            <div className="pane-ledge shrink-0 flex flex-col h-11">
              <LensPicker
                lenses={lens.lenses}
                onFile={lens.lens}
                lensOn={lens.lensOn}
                changedFiles={files.length}
                writing={lens.writing}
                onAllFiles={() => lens.setLensOn(false)}
                onShowLens={() => lens.setLensOn(true)}
                onRun={(picked) => void lens.run(picked)}
                onManage={() => setLensesOpen(true)}
              />
            </div>
          )}
          <DiffFileTree
            files={files}
            groups={lens.shown}
            onFileClick={scrollToFile}
            collapsed={lens.collapsed}
            onCollapsedChange={toggleGroup}
            renderFileTrailing={analysisSignals ? railTrailing : undefined}
          />
        </div>
      )}
      {!sidebarCollapsed && (
        <ResizeHandle
          width={sidebarWidth}
          onWidth={(width) => useUIStore.getState().setDiffFileListWidth(width)}
          min={DIFF_FILE_LIST_MIN_WIDTH}
          max={DIFF_FILE_LIST_MAX_WIDTH}
          defaultWidth={DIFF_FILE_LIST_DEFAULT_WIDTH}
          label="Resize the file list"
        />
      )}
      {/* `relative` so the notes island floats over the diff, not the rail. */}
      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="pane-ledge over-well relative z-30 px-3 py-2 text-sm text-ink/70 flex items-center gap-2 shrink-0">
          <SidebarToggle
            collapsed={sidebarCollapsed}
            onCollapsedChange={(collapsed) => useUIStore.getState().setDiffFileListCollapsed(collapsed)}
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
          {/* Without `min-w-0` a flex item will not shrink below its content,
              and this one wraps to three lines instead of truncating. */}
          <span className="ml-auto min-w-0 truncate text-xs text-text-tertiary">{stats}</span>
          <FullWidthToggle fullWidth={fullWidth} onToggle={onToggleFullWidth} />
          <PanelCloseButton onClose={onClose} />
        </div>
        {/* Extra foot padding while the island shows, so the last card can
            scroll clear of it. */}
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
          {!loading && (
            <LensedFileList
              files={files}
              groups={lens.shown}
              renderFile={renderFile}
              collapsed={lens.collapsed}
              onCollapsedChange={toggleGroup}
            />
          )}
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
        {lensesOpen && (
          <LensDialog
            projectPath={projectPath}
            onRun={(picked) => void lens.run(picked)}
            running={lens.writing?.id ?? null}
            onClose={() => setLensesOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
