import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useState, type ReactNode } from 'react';
import type { FileDiff } from '../../types';
import type { PullRequestDetail, PullRequestFile, ReviewDraft } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { diffShape } from '../../diffSource';
import { describeError } from '../../utils/describeError';
import { BinaryFileView } from '../diff/BinaryFileView';
import { DeferredMount } from '../diff/DeferredMount';
import { DiffFileSection } from '../diff/DiffFileSection';
import { estimateFileHeight } from '../diff/diffMetrics';
import { useBatchedDiffs } from '../diff/useBatchedDiffs';
import { anchorKey, type DiffLineAnchor } from '../diff/diffAnchor';
import { unanchoredThreads } from './reviewAnchors';
import { Icon } from '../terminal/Icon';
import { ReviewThreadView } from './ReviewThreadView';
import { InlineCommentBox, InlineCommentCard } from '../diff/InlineCommentBox';
import { inTreeOrder } from '../diff/DiffFileTree';
import { useThreadActions } from './useThreadActions';

import { Loading } from './Loading';

/** Nothing reaches GitHub until the review is submitted as a batch. */
const DRAFT_HINT = 'Saved locally until you submit the review.';

interface FilesSectionProps {
  projectPath: string;
  detail: PullRequestDetail;
}

export interface FilesSectionHandle {
  /** Open a pending comment for editing — the action bar jumps to one. */
  editDraft: (draftId: string) => void;
}

interface FileSectionProps {
  file: PullRequestFile;
  diff: FileDiff | null | undefined;
  projectPath: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  onAddComment: (path: string, anchor: DiffLineAnchor) => void;
  renderBelowLine?: (path: string, anchor: DiffLineAnchor) => ReactNode;
  viewed: boolean;
  onViewedChange: (path: string, viewed: boolean) => void;
}

/**
 * One file of the pull request, and everything that only it needs to know.
 *
 * Memoized, and holding its own binary view and header rather than being handed
 * them: an element built in the parent's render is a new element every time the
 * parent renders, which is enough on its own to make memoizing pointless. The
 * per-file diffs arrive in batches, so the parent re-renders once per batch —
 * ten times over a large pull request — and with this in place each of those
 * renders touches only the files that batch brought in.
 */
const FileSection = memo(function FileSection({
  file,
  diff,
  projectPath,
  prNumber,
  baseSha,
  headSha,
  onAddComment,
  renderBelowLine,
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

  const headerRight = useMemo(
    () =>
      file.oldPath ? (
        <span
          className="shrink-0 font-mono text-[11px] text-text-tertiary truncate"
          title={`Renamed from ${file.oldPath}`}
        >
          from {file.oldPath}
        </span>
      ) : null,
    [file.oldPath],
  );

  return (
    // Named on the wrapper rather than only on the section inside it, so the
    // rail can scroll to a file that is still a placeholder.
    <DeferredMount
      dataPath={file.path}
      estimatedHeight={estimateFileHeight(diff, file.additions + file.deletions, 1, viewed)}
    >
      <DiffFileSection
        path={file.path}
        status={file.status}
        additions={file.additions}
        deletions={file.deletions}
        diff={diff}
        onAddComment={onAddComment}
        renderBelowLine={renderBelowLine}
        binaryView={binaryView}
        headerRight={headerRight}
        collapsed={viewed}
        onCollapsedChange={onViewedChange}
        collapseLabel="Viewed"
      />
    </DeferredMount>
  );
});

/**
 * Every changed file, with review threads rendered inline against the lines
 * they belong to.
 *
 * Uses the same tree, file section, hunk and line renderers as the worktree
 * diff panel — the only additions are the two review slots those primitives
 * expose. The diff bytes come from the local object database, so context can be
 * expanded past what a GitHub patch would carry, and a very large file renders
 * like any other.
 */
export const FilesSection = forwardRef<FilesSectionHandle, FilesSectionProps>(function FilesSection(
  { projectPath, detail },
  ref,
) {
  const files = useGithubStore((s) => s.files);
  const filesLoading = useGithubStore((s) => s.filesLoading);
  const filesError = useGithubStore((s) => s.filesError);
  const filesFromGit = useGithubStore((s) => s.filesFromGit);
  const drafts = useGithubStore((s) => s.drafts);
  const composingAt = useGithubStore((s) => s.composingAt);

  const diffs = useGithubStore((s) => s.diffs);
  const viewedPaths = useGithubStore((s) => s.viewedPaths);
  const setDiffs = useGithubStore((s) => s.setDiffs);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ editDraft: setEditingDraftId }), []);

  // The head is part of it, not just the file list: a force-push that leaves
  // every path and line count where they were — a reordering, a swap, an
  // amended commit — produces the same shape, and the loader below would then
  // go on showing the previous head's hunks while every review anchor points
  // at the new one.
  const filesFingerprint = useMemo(() => `${detail.headSha}\n${diffShape(files)}`, [files, detail.headSha]);

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

  // Threads and drafts indexed by anchor, so each line render is a map lookup
  // rather than a scan of every thread on the PR.
  const threadsByAnchor = useMemo(() => {
    // A thread with no line has no anchor to sit on; it is collected as an
    // orphan below rather than grouped here.
    const anchored = detail.threads.filter((t) => (t.line ?? t.originalLine) != null);
    return Map.groupBy(anchored, (t) => anchorKey(t.path, (t.line ?? t.originalLine)!, t.side));
  }, [detail.threads]);

  const draftsByAnchor = useMemo(
    () => Map.groupBy(drafts, (draft) => anchorKey(draft.path, draft.line, draft.side)),
    [drafts],
  );

  // Threads with nowhere to render, collected so they stay readable. Computed
  // once the diffs are all in: it walks every line of every file, so running it
  // per arriving batch would be quadratic for an answer only final at the end.
  const orphanThreads = useMemo(
    () => (filesLoading ? [] : unanchoredThreads(detail.threads, files, diffs)),
    [filesLoading, detail.threads, files, diffs],
  );

  const startComment = useCallback((path: string, anchor: DiffLineAnchor) => {
    setEditingDraftId(null);
    useGithubStore.getState().setComposingAt({ path, line: anchor.line, side: anchor.side });
  }, []);

  const saveDraft = useCallback(
    async (input: { id?: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => {
      try {
        await window.api.github.saveDraft(projectPath, {
          id: input.id,
          prNumber: detail.number,
          path: input.path,
          line: input.line,
          side: input.side,
          body: input.body,
        });
      } catch (error) {
        // Leave the box open and say so. Closing it on a failed save discards
        // what was written with nothing to show for it.
        useProjectStore.getState().addToast(`Could not save the comment: ${describeError(error)}`, 'error');
        return;
      }
      useGithubStore.getState().setComposingAt(null);
      setEditingDraftId(null);
      await useGithubStore.getState().loadDrafts(projectPath, detail.number);
    },
    [projectPath, detail.number],
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
      const composing =
        composingAt?.path === path && composingAt.line === anchor.line && composingAt.side === anchor.side;

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
                onSave={(body) => saveDraft({ id: draft.id, path, line: anchor.line, side: anchor.side, body })}
                onCancel={() => setEditingDraftId(null)}
                onDiscard={() => discardDraft(draft)}
                hint={DRAFT_HINT}
              />
            ) : (
              <InlineCommentCard
                key={draft.id}
                label="Unsent comment"
                body={draft.body}
                onClick={() => setEditingDraftId(draft.id)}
              />
            ),
          )}
          {composing && (
            <InlineCommentBox
              onSave={(body) => saveDraft({ path, line: anchor.line, side: anchor.side, body })}
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
      composingAt,
      editingDraftId,
      replyToThread,
      toggleResolved,
      saveDraft,
      discardDraft,
    ],
  );

  /**
   * Withheld when there is nothing that could render below a line: passing it
   * costs a key build and two map lookups per line of the diff, and makes
   * saving the first comment re-render every mounted file.
   */
  const renderBelowLine =
    threadsByAnchor.size > 0 || draftsByAnchor.size > 0 || composingAt ? renderComments : undefined;

  // A Set so a hundred file sections do not each scan the list.
  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);

  const setViewed = useCallback(
    (path: string, next: boolean) => {
      useGithubStore.getState().setFileViewed(projectPath, detail.number, detail.headSha, path, next);
    },
    [projectPath, detail.number, detail.headSha],
  );

  const renderFile = (file: PullRequestFile) => (
    <FileSection
      key={file.path}
      file={file}
      diff={diffs.get(file.path)}
      projectPath={projectPath}
      prNumber={detail.number}
      baseSha={detail.baseSha}
      headSha={detail.headSha}
      onAddComment={startComment}
      renderBelowLine={renderBelowLine}
      viewed={viewed.has(file.path)}
      onViewedChange={setViewed}
    />
  );

  return (
    <>
      {filesFromGit && (
        <div className="px-3 py-2 font-mono text-[11px] text-text-tertiary border-b border-ink/[0.06]">
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

      <div className="diff-list pb-3">{inTreeOrder(files).map((file) => renderFile(file))}</div>

      {orphanThreads.length > 0 && (
        <>
          <div className="px-3 py-2 font-mono text-[11px] text-text-tertiary border-t border-ink/[0.06]">
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
        <div className="flex items-center justify-center gap-1.5 px-3 py-3 font-mono text-[11px] text-text-tertiary border-t border-ink/[0.06]">
          <Icon name="warning" className="w-3 h-3" />
          Showing {files.length} of {detail.changedFiles} changed files
        </div>
      )}
    </>
  );
});
