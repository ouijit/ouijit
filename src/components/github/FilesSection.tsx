import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { FileDiff } from '../../types';
import type { PullRequestDetail, ReviewDraft, ReviewThread } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { DiffFileSection } from '../diff/DiffFileSection';
import type { DiffLineAnchor } from '../diff/DiffLineView';
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

/** Key for the (path, line, side) triple that anchors a comment. */
function anchorKey(path: string, line: number, side: 'LEFT' | 'RIGHT'): string {
  return `${path} ${line} ${side}`;
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

  const [diffs, setDiffs] = useState<Map<string, FileDiff | null>>(new Map());
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ editDraft: setEditingDraftId }), []);

  const filesFingerprint = useMemo(() => files.map((f) => `${f.status}:${f.path}`).join('\n'), [files]);

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

  /**
   * Threads that will never render inline — either they carry no anchor line at
   * all, or they sit on a file this diff doesn't include (a thread left on a
   * file that a later push reverted, or one past the file cap). Collected so
   * they're still readable instead of silently disappearing.
   */
  const orphanThreads = useMemo(() => {
    const renderedPaths = new Set(files.map((f) => f.path));
    return detail.threads.filter((t) => (t.line ?? t.originalLine) == null || !renderedPaths.has(t.path));
  }, [detail.threads, files]);

  const startComment = useCallback((path: string, anchor: DiffLineAnchor) => {
    setEditingDraftId(null);
    useGithubStore.getState().setComposingAt({ path, line: anchor.line, side: anchor.side });
  }, []);

  const saveDraft = useCallback(
    async (input: { id?: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }) => {
      await window.api.github.saveDraft(projectPath, {
        id: input.id,
        prNumber: detail.number,
        path: input.path,
        line: input.line,
        side: input.side,
        body: input.body,
      });
      useGithubStore.getState().setComposingAt(null);
      setEditingDraftId(null);
      await useGithubStore.getState().loadDrafts(projectPath, detail.number);
    },
    [projectPath, detail.number],
  );

  const discardDraft = useCallback(
    async (draft: ReviewDraft) => {
      await window.api.github.discardDraft(projectPath, draft.id);
      setEditingDraftId(null);
      await useGithubStore.getState().loadDrafts(projectPath, detail.number);
    },
    [projectPath, detail.number],
  );

  const replyToThread = useCallback(
    async (thread: ReviewThread, body: string) => {
      const target = thread.comments[thread.comments.length - 1] ?? thread.comments[0];
      if (!target?.databaseId) return;
      const result = await window.api.github.replyToThread(projectPath, detail.number, target.databaseId, body);
      if (!result.success) return;
      await useGithubStore.getState().reloadDetail(projectPath);
    },
    [projectPath, detail.number],
  );

  const toggleResolved = useCallback(
    async (thread: ReviewThread) => {
      const result = await window.api.github.resolveThread(projectPath, thread.id, !thread.isResolved);
      if (!result.success) return;
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
                className="block w-[calc(100%-176px)] mx-[88px] my-1.5 text-left px-3 py-2 bg-terminal-surface border-l-2 border-dashed border-accent rounded-md text-sm text-text-secondary hover:bg-ink/[0.04] transition-colors duration-100"
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

      {shown.map((file) => (
        <DiffFileSection
          key={file.path}
          path={file.path}
          status={file.status}
          additions={file.additions}
          deletions={file.deletions}
          diff={diffs.get(file.path) ?? null}
          onAddComment={startComment}
          renderBelowLine={(anchor) => renderBelowLine(file.path, anchor)}
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
      ))}

      {!only && orphanThreads.length > 0 && (
        <>
          <div className="px-3 py-2 font-mono text-[11px] text-text-tertiary border-t border-ink/[0.06]">
            {orphanThreads.length} {orphanThreads.length === 1 ? 'thread' : 'threads'} on lines outside this diff
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
