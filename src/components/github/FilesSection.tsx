import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { FileDiff } from '../../types';
import type { PullRequestDetail, PullRequestFile, ReviewDraft, ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { BinaryFileView } from '../diff/BinaryFileView';
import { DiffFileSection } from '../diff/DiffFileSection';
import type { DiffLineAnchor } from '../diff/diffAnchor';
import { anchorKey, unanchoredThreads } from './reviewAnchors';
import { Icon } from '../terminal/Icon';
import { ReviewThreadView } from './ReviewThreadView';
import { DraftCommentBox } from './DraftCommentBox';

import { Loading } from './Loading';

const DIFF_BATCH_SIZE = 10;

interface FilesSectionProps {
  projectPath: string;
  detail: PullRequestDetail;
  /** Render only this file. Omitted, the whole diff renders in order. */
  only?: string | null;
}

export interface FilesSectionHandle {
  /** Open a pending comment for editing — the action bar jumps to one. */
  editDraft: (draftId: string) => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  { projectPath, detail, only },
  ref,
) {
  const files = useGithubStore((s) => s.files);
  const filesLoading = useGithubStore((s) => s.filesLoading);
  const filesError = useGithubStore((s) => s.filesError);
  const filesFromGit = useGithubStore((s) => s.filesFromGit);
  const drafts = useGithubStore((s) => s.drafts);
  const composingAt = useGithubStore((s) => s.composingAt);
  const lensGroups = useGithubStore((s) => s.lensGroups);

  const [diffs, setDiffs] = useState<Map<string, FileDiff | null>>(new Map());
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
  }, [filesFingerprint, projectPath, detail.number, detail.baseSha, detail.headSha]);

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
              <DraftCommentBox
                key={draft.id}
                draft={draft}
                onSave={(body) => saveDraft({ id: draft.id, path, line: anchor.line, side: anchor.side, body })}
                onCancel={() => setEditingDraftId(null)}
                onDiscard={() => discardDraft(draft)}
              />
            ) : (
              <button
                key={draft.id}
                type="button"
                data-draft-id={draft.id}
                className="block w-[calc(100%-176px)] mx-[88px] my-1.5 text-left px-3 py-2 bg-terminal-surface rounded-md text-sm text-text-secondary hover:bg-ink/[0.06] transition-colors duration-100"
                onClick={() => setEditingDraftId(draft.id)}
              >
                <span className="block text-[11px] text-accent mb-0.5">Unsent comment</span>
                {draft.body}
              </button>
            ),
          )}
          {composing && (
            <DraftCommentBox
              onSave={(body) => saveDraft({ path, line: anchor.line, side: anchor.side, body })}
              onCancel={() => useGithubStore.getState().setComposingAt(null)}
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

  const shown = only ? files.filter((f) => f.path === only) : files;

  const renderFile = (file: PullRequestFile) => (
    <DiffFileSection
      key={file.path}
      path={file.path}
      status={file.status}
      additions={file.additions}
      deletions={file.deletions}
      diff={diffs.get(file.path)}
      onAddComment={startComment}
      renderBelowLine={(anchor) => renderBelowLine(file.path, anchor)}
      binaryView={
        <BinaryFileView
          path={file.path}
          revision={`${detail.baseSha}...${detail.headSha}`}
          load={() =>
            window.api.github.pullRequestFileVersions(
              projectPath,
              detail.number,
              detail.baseSha,
              detail.headSha,
              file.path,
              file.oldPath,
            )
          }
        />
      }
      headerRight={
        file.oldPath ? (
          <span
            className="shrink-0 font-mono text-[11px] text-text-tertiary truncate"
            title={`Renamed from ${file.oldPath}`}
          >
            from {file.oldPath}
          </span>
        ) : null
      }
    />
  );

  // A lens rearranges the whole document, so it applies only when the whole
  // document is what's on screen. Reading one file is already the narrowest
  // view there is; grouping a single file would be grouping nothing.
  const grouped = !only && lensGroups ? lensGroups : null;
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

      {grouped
        ? grouped.map((group) => (
            <div key={group.title} className="flex flex-col">
              <div className="sticky top-0 z-10 px-3 py-2 bg-surface border-b border-ink/[0.06]">
                <div className="text-[12px] font-medium text-text-primary">{group.title}</div>
                {group.summary && <div className="text-[11px] text-text-tertiary">{group.summary}</div>}
              </div>
              {group.paths.map((path) => {
                const file = byPath.get(path);
                return file ? renderFile(file) : null;
              })}
            </div>
          ))
        : shown.map(renderFile)}

      {!only && orphanThreads.length > 0 && (
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

      {!only && detail.changedFiles > files.length && (
        <div className="flex items-center justify-center gap-1.5 px-3 py-3 font-mono text-[11px] text-text-tertiary border-t border-ink/[0.06]">
          <Icon name="warning" className="w-3 h-3" />
          Showing {files.length} of {detail.changedFiles} changed files
        </div>
      )}
    </>
  );
});
