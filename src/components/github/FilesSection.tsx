import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FileDiff } from '../../types';
import type { PullRequestDetail, PullRequestFile, ReviewDraft } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { prFilesFingerprint } from '../../diffSource';
import { describeError } from '../../utils/describeError';
import { BinaryFileView } from '../diff/BinaryFileView';
import { DeferredMount } from '../diff/DeferredMount';
import { DiffFileSection } from '../diff/DiffFileSection';
import { estimateFileHeight } from '../diff/diffMetrics';
import { useDiffSlices } from '../diff/diffSlice';
import { useBatchedDiffs } from '../diff/useBatchedDiffs';
import {
  anchorKey,
  anchorStart,
  blockAt,
  composingAt as composingAtAnchor,
  type DiffLineAnchor,
} from '../../diffAnchor';
import { describeLines } from '../../diffAnchor';
import { sectionKey, type ResolvedGroup, type ResolvedSlice } from '../../lens/lens';
import { isSectionViewed } from '../../github/viewedSections';
import { unanchoredThreads } from './reviewAnchors';
import { Icon } from '../terminal/Icon';
import { ReviewThreadView } from './ReviewThreadView';
import { InlineCommentBox, InlineCommentCard } from '../diff/InlineCommentBox';
import { LensedFileList } from '../diff/LensedFileList';
import { useThreadActions } from './useThreadActions';
import { usePullRequestSignals } from '../../hooks/usePullRequestSignals';
import { AnalysisChip, worthAChip } from '../diff/AnalysisChip';
import type { FileAnalysis } from '../../analysis/types';

import { Loading } from './Loading';

/** Nothing reaches GitHub until the review is submitted as a batch. */
const DRAFT_HINT = 'Saved locally until you submit the review.';

const UNPLACEABLE_HINT = 'The code this was written on is not in the diff any more. Sending will fail the review.';

/** Passes the analysis through unchanged, so `FileSection`'s memo still holds. */
function chipworthy(analysis: FileAnalysis | undefined): FileAnalysis | undefined {
  return analysis && worthAChip(analysis) ? analysis : undefined;
}

interface FilesSectionProps {
  projectPath: string;
  detail: PullRequestDetail;
  /** The order the rail shows these files in, which the document follows. */
  order: readonly string[];
  /** The lens bound to this diff, when the reader has it on. */
  groups: ResolvedGroup[] | null;
  /** The grouping has just arrived, so its parts lay themselves in. */
  revealing?: boolean;
}

export interface FilesSectionHandle {
  /** Open a pending comment for editing — the action bar jumps to one. */
  editDraft: (draftId: string) => void;
}

interface FileSectionProps {
  file: PullRequestFile;
  /** Which part of the change this copy of the file sits in. */
  sectionId: string;
  diff: FileDiff | null | undefined;
  /** What the hunks on screen come to, which under a lens is not the file's. */
  additions: number;
  deletions: number;
  projectPath: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  onAddComment: (path: string, anchor: DiffLineAnchor) => void;
  renderBelowLine?: (path: string, anchor: DiffLineAnchor) => ReactNode;
  markLine?: (path: string, anchor: DiffLineAnchor) => boolean;
  analysis?: FileAnalysis;
  viewed: boolean;
  onViewedChange: (sectionId: string, path: string, viewed: boolean) => void;
}

/**
 * One file of the pull request. Builds its own binary view and header rather
 * than taking them as props: an element built in the parent's render is new
 * every time, which would defeat the memo. Diffs arrive in batches, so the
 * parent re-renders once per batch.
 */
const FileSection = memo(function FileSection({
  file,
  sectionId,
  diff,
  additions,
  deletions,
  projectPath,
  prNumber,
  baseSha,
  headSha,
  onAddComment,
  renderBelowLine,
  markLine,
  analysis,
  viewed,
  onViewedChange,
}: FileSectionProps) {
  const binaryView = useMemo(
    () => (
      <BinaryFileView
        path={file.path}
        revision={`${baseSha}...${headSha}`}
        load={() =>
          window.api.github.pullRequestFileVersions(projectPath, prNumber, baseSha, headSha, file.path, file.oldPath)
        }
      />
    ),
    [projectPath, prNumber, baseSha, headSha, file.path, file.oldPath],
  );

  const setViewed = useCallback(
    (section: string, next: boolean) => onViewedChange(section, file.path, next),
    [onViewedChange, file.path],
  );

  const headerRight = useMemo(
    () =>
      file.oldPath || analysis ? (
        <>
          {file.oldPath && (
            <span
              className="shrink-0 font-mono text-[11px] text-text-tertiary truncate"
              title={`Renamed from ${file.oldPath}`}
            >
              from {file.oldPath}
            </span>
          )}
          {analysis && <AnalysisChip signal={analysis.signal} missing={analysis.missing} />}
        </>
      ) : null,
    [file.oldPath, analysis],
  );

  return (
    // On the wrapper as well as the section, so the rail can scroll to a file
    // that is still a placeholder.
    <DeferredMount dataPath={file.path} estimatedHeight={estimateFileHeight(diff, additions + deletions, 1, viewed)}>
      <DiffFileSection
        path={file.path}
        status={file.status}
        additions={additions}
        deletions={deletions}
        diff={diff}
        onAddComment={onAddComment}
        renderBelowLine={renderBelowLine}
        markLine={markLine}
        binaryView={binaryView}
        headerRight={headerRight}
        collapsed={viewed}
        sectionId={sectionId}
        onCollapsedChange={setViewed}
        collapseLabel="Viewed"
      />
    </DeferredMount>
  );
});

/**
 * Every changed file, with review threads inline against their lines. Uses the
 * worktree diff panel's renderers plus their two review slots. Diff bytes come
 * from the local object database, not GitHub's patches, so context is not
 * capped at what a patch would carry.
 */
export const FilesSection = forwardRef<FilesSectionHandle, FilesSectionProps>(function FilesSection(
  { projectPath, detail, order, groups, revealing },
  ref,
) {
  const files = useGithubStore((s) => s.files);
  const filesLoading = useGithubStore((s) => s.filesLoading);
  const filesError = useGithubStore((s) => s.filesError);
  const filesFromGit = useGithubStore((s) => s.filesFromGit);
  const drafts = useGithubStore((s) => s.drafts);
  const composingWhere = useGithubStore((s) => s.composingAt);

  const diffs = useGithubStore((s) => s.diffs);
  const viewedPaths = useGithubStore((s) => s.viewedPaths);
  const viewedParts = useGithubStore((s) => s.viewedSections);
  const collapsed = useGithubStore((s) => s.collapsedGroups);
  const setDiffs = useGithubStore((s) => s.setDiffs);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  // Through a ref so the save callback survives each batch of diffs arriving.
  const diffsRef = useRef(diffs);
  diffsRef.current = diffs;

  useImperativeHandle(ref, () => ({ editDraft: setEditingDraftId }), []);

  // The head is part of the fingerprint: an amend or reorder can leave every
  // path and line count identical, and the loader would then keep the old
  // head's hunks while every review anchor points at the new one.
  const filesFingerprint = useMemo(() => prFilesFingerprint(detail.headSha, files), [files, detail.headSha]);

  // Data per path rather than elements: FileSection is memoized and builds
  // its own header, so its props have to keep their identity between renders.
  const analysis = usePullRequestSignals(detail.headSha, files);

  useBatchedDiffs(
    files,
    filesFingerprint,
    (file) =>
      window.api.github.pullRequestFileDiff(
        projectPath,
        detail.number,
        detail.baseSha,
        detail.headSha,
        file.path,
        undefined,
        // A renamed file needs both paths, or git reports it as a whole-file
        // add rather than as the edit it actually is.
        file.oldPath,
      ),
    setDiffs,
  );

  // Indexed by anchor, so each line render is a lookup rather than a scan.
  const threadsByAnchor = useMemo(() => {
    // A thread with no line has no anchor; it is collected as an orphan below.
    const anchored = detail.threads.filter((t) => (t.line ?? t.originalLine) != null);
    return Map.groupBy(anchored, (t) => anchorKey(t.path, (t.line ?? t.originalLine)!, t.side));
  }, [detail.threads]);

  const draftsByAnchor = useMemo(
    () => Map.groupBy(drafts, (draft) => anchorKey(draft.path, draft.line, draft.side)),
    [drafts],
  );

  // Computed once every diff is in: it walks every line of every file, and the
  // answer is only final at the end anyway.
  const orphanThreads = useMemo(
    () => (filesLoading ? [] : unanchoredThreads(detail.threads, files, diffs)),
    [filesLoading, detail.threads, files, diffs],
  );

  const startComment = useCallback((path: string, anchor: DiffLineAnchor) => {
    setEditingDraftId(null);
    useGithubStore.getState().setComposingAt({ path, ...anchor });
  }, []);

  const saveDraft = useCallback(
    async (input: {
      id?: string;
      path: string;
      line: number;
      startLine?: number;
      side: 'LEFT' | 'RIGHT';
      snippet?: string | null;
      body: string;
    }) => {
      try {
        await window.api.github.saveDraft(projectPath, {
          id: input.id,
          prNumber: detail.number,
          path: input.path,
          line: input.line,
          startLine: input.startLine,
          side: input.side,
          snippet: input.snippet,
          headSha: detail.headSha,
          body: input.body,
        });
      } catch (error) {
        // Leave the box open: closing it on a failed save discards the text.
        useProjectStore.getState().addToast(`Could not save the comment: ${describeError(error)}`, 'error');
        return;
      }
      useGithubStore.getState().setComposingAt(null);
      setEditingDraftId(null);
      await useGithubStore.getState().loadDrafts(projectPath, detail.number);
    },
    [projectPath, detail.number, detail.headSha],
  );

  const discardDraft = useCallback(
    async (draft: ReviewDraft) => {
      try {
        await window.api.github.discardDraft(projectPath, draft.id);
      } catch (error) {
        useProjectStore.getState().addToast(`Could not discard the comment: ${describeError(error)}`, 'error');
        return;
      }
      setEditingDraftId(null);
      await useGithubStore.getState().loadDrafts(projectPath, detail.number);
    },
    [projectPath, detail.number],
  );

  const { replyToThread, toggleResolved } = useThreadActions(projectPath, detail.number);

  const renderComments = useCallback(
    (path: string, anchor: DiffLineAnchor) => {
      const key = anchorKey(path, anchor.line, anchor.side);
      const threads = threadsByAnchor.get(key);
      const anchorDrafts = draftsByAnchor.get(key);
      const composing = composingAtAnchor(composingWhere, path, anchor);

      if (!threads && !anchorDrafts && !composing) return null;

      return (
        <div className="py-1">
          {threads?.map((thread) => (
            <ReviewThreadView
              key={thread.id}
              thread={thread}
              inline
              onReply={replyToThread}
              onToggleResolved={toggleResolved}
            />
          ))}
          {anchorDrafts?.map((draft) =>
            editingDraftId === draft.id ? (
              <InlineCommentBox
                key={draft.id}
                initialBody={draft.body}
                saveLabel="Update comment"
                onSave={(body) => saveDraft({ id: draft.id, path, line: draft.line, side: draft.side, body })}
                onCancel={() => setEditingDraftId(null)}
                onDiscard={() => discardDraft(draft)}
                hint={draft.unplaceable ? UNPLACEABLE_HINT : DRAFT_HINT}
              />
            ) : (
              <InlineCommentCard
                key={draft.id}
                label={`Unsent comment · ${describeLines(draft.startLine, draft.line)}`}
                body={draft.body}
                onClick={() => setEditingDraftId(draft.id)}
              />
            ),
          )}
          {composing && (
            <InlineCommentBox
              onSave={(body) =>
                saveDraft({
                  path,
                  line: composing.line,
                  startLine: composing.startLine,
                  side: composing.side,
                  snippet: blockAt(diffsRef.current.get(path), composing),
                  body,
                })
              }
              onCancel={() => useGithubStore.getState().setComposingAt(null)}
              hint={DRAFT_HINT}
            />
          )}
        </div>
      );
    },
    [
      threadsByAnchor,
      draftsByAnchor,
      composingWhere,
      editingDraftId,
      replyToThread,
      toggleResolved,
      saveDraft,
      discardDraft,
    ],
  );

  // Which lines a comment covers without rendering on them — see the same
  // computation in the worktree panel.
  const spans = useMemo(() => {
    const saved = drafts.filter((draft) => draft.startLine !== draft.line);
    return composingWhere && anchorStart(composingWhere) !== composingWhere.line ? [...saved, composingWhere] : saved;
  }, [drafts, composingWhere]);

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

  /**
   * Withheld when nothing could render below a line: passing it costs a key
   * build and two map lookups per diff line.
   */
  const renderBelowLine =
    threadsByAnchor.size > 0 || draftsByAnchor.size > 0 || composingWhere ? renderComments : undefined;

  const sliceFor = useDiffSlices();

  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);

  /**
   * Marking one part read has to know what the others are, since the claim that
   * gets written down is about the file.
   */
  const partsOf = useMemo(() => {
    const byFile = new Map<string, string[]>();
    for (const group of groups ?? []) {
      for (const slice of group.slices) {
        byFile.set(slice.path, [...(byFile.get(slice.path) ?? []), sectionKey(group.id, slice.path)]);
      }
    }
    return byFile;
  }, [groups]);

  const setViewed = useCallback(
    (section: string, path: string, next: boolean) => {
      useGithubStore.getState().markSectionViewed(path, section, partsOf.get(path) ?? [path], next);
    },
    [partsOf],
  );

  const setGroupCollapsed = useGithubStore((s) => s.setGroupCollapsed);

  const renderFile = (file: PullRequestFile, key?: string, slice?: ResolvedSlice) => (
    <FileSection
      key={key ?? file.path}
      sectionId={key ?? file.path}
      file={file}
      diff={sliceFor(file.path, diffs.get(file.path), slice?.hunks)}
      additions={slice?.changes?.additions ?? file.additions}
      deletions={slice?.changes?.deletions ?? file.deletions}
      projectPath={projectPath}
      prNumber={detail.number}
      baseSha={detail.baseSha}
      headSha={detail.headSha}
      onAddComment={startComment}
      renderBelowLine={renderBelowLine}
      markLine={spans.length > 0 ? markLine : undefined}
      analysis={chipworthy(analysis?.[file.path])}
      viewed={isSectionViewed(viewed, viewedParts, key ?? file.path, file.path)}
      onViewedChange={setViewed}
    />
  );

  return (
    <>
      {filesFromGit && (
        <div className="px-3 py-2 font-mono text-[11px] text-text-tertiary border-b border-separator">
          File list read from git — GitHub&apos;s list was unavailable
          {filesError ? `: ${filesError}` : ''}.
        </div>
      )}
      {filesLoading && files.length === 0 && <Loading label="Loading files" />}
      {!filesLoading && files.length === 0 && (
        <div className="px-3 py-8 text-center font-mono text-[11px] text-text-tertiary">
          {filesError ?? 'No files changed'}
        </div>
      )}

      <div className="diff-list pb-3">
        <LensedFileList
          files={files}
          order={order}
          groups={groups}
          renderFile={renderFile}
          collapsed={collapsed}
          onCollapsedChange={setGroupCollapsed}
          revealing={revealing}
        />
      </div>

      {orphanThreads.length > 0 && (
        <>
          <div className="px-3 py-2 font-mono text-[11px] text-text-tertiary border-t border-separator">
            {orphanThreads.length} {orphanThreads.length === 1 ? 'thread' : 'threads'} not anchored in this diff
          </div>
          {orphanThreads.map((thread) => (
            <ReviewThreadView
              key={thread.id}
              thread={thread}
              onReply={replyToThread}
              onToggleResolved={toggleResolved}
            />
          ))}
        </>
      )}

      {detail.changedFiles > files.length && (
        <div className="flex items-center justify-center gap-1.5 px-3 py-3 font-mono text-[11px] text-text-tertiary border-t border-separator">
          <Icon name="warning" className="w-3 h-3" />
          Showing {files.length} of {detail.changedFiles} changed files
        </div>
      )}
    </>
  );
});
