import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { FileDiff } from '../../types';
import type { PullRequestDetail, PullRequestFile, ReviewDraft, ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { BinaryFileView } from '../diff/BinaryFileView';
import { DeferredMount } from '../diff/DeferredMount';
import { DiffFileSection } from '../diff/DiffFileSection';
import { estimateFileHeight } from '../diff/diffMetrics';
import { useDiffSlices } from '../diff/diffSlice';
import { inTreeOrder } from '../diff/DiffFileTree';
import type { DiffLineAnchor } from '../diff/diffAnchor';
import type { ResolvedGroup } from '../../github/lens';
import { anchorKey, unanchoredThreads } from './reviewAnchors';
import { Icon } from '../terminal/Icon';
import { ReviewThreadView } from './ReviewThreadView';
import { InlineCommentBox, InlineCommentCard } from '../diff/InlineCommentBox';
import { LensGroupSection } from '../diff/LensGroupSection';

import { Loading } from './Loading';

const DIFF_BATCH_SIZE = 10;

/** Nothing reaches GitHub until the review is submitted as a batch. */
const DRAFT_HINT = 'Saved locally until you submit the review.';

interface FilesSectionProps {
  projectPath: string;
  detail: PullRequestDetail;
  /** The lens bound to this diff, when the reader has it on. */
  groups?: ResolvedGroup[] | null;
}

export interface FilesSectionHandle {
  /** Open a pending comment for editing — the action bar jumps to one. */
  editDraft: (draftId: string) => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface FileSectionProps {
  file: PullRequestFile;
  diff: FileDiff | null | undefined;
  projectPath: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  onAddComment: (path: string, anchor: DiffLineAnchor) => void;
  renderBelowLine: (path: string, anchor: DiffLineAnchor) => ReactNode;
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
    // rail can scroll to a file that is still a placeholder — which, in a diff
    // this long, is most of them.
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
        onCollapsedChange={(next) => onViewedChange(file.path, next)}
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
  { projectPath, detail, groups },
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
  const collapsedGroups = useGithubStore((s) => s.collapsedGroups);
  const setDiffs = useGithubStore((s) => s.setDiffs);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ editDraft: setEditingDraftId }), []);

  const filesFingerprint = useMemo(
    () => files.map((f) => `${f.status}:${f.oldPath ?? ''}:${f.path}`).join('\n'),
    [files],
  );

  // Same batched load the worktree panel uses: ten files at a time, one state
  // write per batch rather than one per file.
  useEffect(() => {
    let cancelled = false;
    setDiffs(new Map());
    if (files.length === 0) return;

    const accumulated = new Map<string, FileDiff | null>();

    const load = async () => {
      for (let i = 0; i < files.length; i += DIFF_BATCH_SIZE) {
        if (cancelled) return;
        const batch = files.slice(i, i + DIFF_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (file): Promise<[string, FileDiff | null]> => {
            try {
              const diff = await window.api.github.pullRequestFileDiff(
                projectPath,
                detail.number,
                detail.baseSha,
                detail.headSha,
                file.path,
                undefined,
                // A renamed file needs both paths, or git reports it as a
                // whole-file add rather than as the edit it actually is.
                file.oldPath,
              );
              return [file.path, diff];
            } catch {
              return [file.path, null];
            }
          }),
        );
        if (cancelled) return;
        for (const [path, diff] of results) accumulated.set(path, diff);
        setDiffs(new Map(accumulated));
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filesFingerprint is the stable proxy for files
  }, [filesFingerprint, projectPath, detail.number, detail.baseSha, detail.headSha, setDiffs]);

  // Threads and drafts indexed by anchor, so each line render is a map lookup
  // rather than a scan of every thread on the PR.
  const threadsByAnchor = useMemo(() => {
    const map = new Map<string, ReviewThread[]>();
    for (const thread of detail.threads) {
      const line = thread.line ?? thread.originalLine;
      if (line == null) continue;
      const key = anchorKey(thread.path, line, thread.side);
      const existing = map.get(key);
      if (existing) existing.push(thread);
      else map.set(key, [thread]);
    }
    return map;
  }, [detail.threads]);

  const draftsByAnchor = useMemo(() => {
    const map = new Map<string, ReviewDraft[]>();
    for (const draft of drafts) {
      const key = anchorKey(draft.path, draft.line, draft.side);
      const existing = map.get(key);
      if (existing) existing.push(draft);
      else map.set(key, [draft]);
    }
    return map;
  }, [drafts]);

  // Threads with nowhere to render, collected so they stay readable instead of
  // silently disappearing.
  const orphanThreads = useMemo(() => unanchoredThreads(detail.threads, files, diffs), [detail.threads, files, diffs]);

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
        useProjectStore.getState().addToast(`Could not save the comment: ${describe(error)}`, 'error');
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
        useProjectStore.getState().addToast(`Could not discard the comment: ${describe(error)}`, 'error');
        return;
      }
      setEditingDraftId(null);
      await useGithubStore.getState().loadDrafts(projectPath, detail.number);
    },
    [projectPath, detail.number],
  );

  const replyToThread = useCallback(
    async (thread: ReviewThread, body: string) => {
      const target = thread.comments[thread.comments.length - 1] ?? thread.comments[0];
      if (!target?.databaseId) {
        useProjectStore.getState().addToast('Could not find the comment to reply to', 'error');
        return;
      }
      const result = await window.api.github.replyToThread(projectPath, detail.number, target.databaseId, body);
      if (!result.success) {
        // The reply box clears itself on return, so a silent failure took the
        // typed text with it.
        useProjectStore.getState().addToast(result.error ?? 'Reply failed', 'error');
        return;
      }
      await useGithubStore.getState().reloadDetail(projectPath);
    },
    [projectPath, detail.number],
  );

  const toggleResolved = useCallback(
    async (thread: ReviewThread) => {
      const result = await window.api.github.resolveThread(projectPath, thread.id, !thread.isResolved);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not update the thread', 'error');
        return;
      }
      await useGithubStore.getState().reloadDetail(projectPath);
    },
    [projectPath],
  );

  const renderBelowLine = useCallback(
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
                data-draft-id={draft.id}
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

  // The same order the rail lists them in. Without this the document runs in
  // whatever order the file list arrived and the two disagree the moment a
  // directory's files are not contiguous in it.
  const ordered = useMemo(() => inTreeOrder(files), [files]);

  // A new pull request, or a new grouping of this one, makes every cached
  // slice meaningless.
  const sliceFor = useDiffSlices(groups ?? detail.number);

  // A Set so a hundred file sections do not each scan the list.
  const viewed = useMemo(() => new Set(viewedPaths), [viewedPaths]);
  const collapsed = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);

  const setViewed = useCallback(
    (path: string, next: boolean) => {
      useGithubStore.getState().setFileViewed(projectPath, detail.number, detail.headSha, path, next);
    },
    [projectPath, detail.number, detail.headSha],
  );

  const renderFile = (file: PullRequestFile, key?: string, hunks?: number[]) => (
    <FileSection
      key={key ?? file.path}
      file={file}
      diff={sliceFor(file.path, diffs.get(file.path), hunks)}
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

  const byPath = new Map(files.map((f) => [f.path, f]));

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

      <div className="diff-list pb-3">
        {groups
          ? groups.map((group) => (
              <LensGroupSection
                key={group.title}
                group={group}
                collapsed={collapsed.has(group.title)}
                onCollapsedChange={(next) => useGithubStore.getState().setGroupCollapsed(group.title, next)}
              >
                {group.slices.map((slice) => {
                  const file = byPath.get(slice.path);
                  return file ? renderFile(file, `${group.title}:${slice.path}`, slice.hunks) : null;
                })}
              </LensGroupSection>
            ))
          : ordered.map((file) => renderFile(file))}
      </div>

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
