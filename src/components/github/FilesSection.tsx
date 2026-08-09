import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { inTreeOrder } from '../diff/DiffFileTree';
import type { DiffLineAnchor } from '../diff/diffAnchor';
import type { ResolvedGroup } from '../../github/lens';
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

/**
 * A file's diff narrowed to the hunks one part of the story claims.
 *
 * Selection is by whole hunk — a lens says which hunks belong to a part, never
 * where to cut one. Halving a hunk would strip the context lines that make a
 * diff readable, and a hunk is already the smallest piece that stands alone.
 */
function sliceDiff(diff: FileDiff | null | undefined, hunks?: number[]): FileDiff | null | undefined {
  if (!diff || !hunks) return diff;
  return { ...diff, hunks: hunks.map((i) => diff.hunks[i]).filter(Boolean) };
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
  const belowLine = useCallback(
    (anchor: DiffLineAnchor) => renderBelowLine(file.path, anchor),
    [renderBelowLine, file.path],
  );

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
    <DeferredMount estimatedHeight={estimateFileHeight(diff, file.additions + file.deletions, 1, viewed)}>
      <DiffFileSection
        path={file.path}
        status={file.status}
        additions={file.additions}
        deletions={file.deletions}
        diff={diff}
        onAddComment={onAddComment}
        renderBelowLine={belowLine}
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
 * One part of a lens, with the files that make it up.
 *
 * Two things pin themselves to the top of this pane — which part of the change
 * you are in, and which file you are in — and they are a hierarchy, not rivals
 * for the same line. Both were pinned to `top: 0`, so the file header sat on
 * top of the part it belongs to and the lens became invisible exactly
 * when it was being used.
 *
 * The part header measures itself and publishes its height, and file headers
 * pin below it. Measured rather than hard-coded to the one line it is set to:
 * the number this has to agree with is a rendered height, and text that grows
 * with the platform's font size would leave a fixed offset behind. Nothing
 * publishes it without a lens, and the fallback of `0px` is what every other
 * diff in the app already does.
 */
function LensGroup({
  group,
  collapsed,
  onCollapsedChange,
  children,
}: {
  group: ResolvedGroup;
  /** Folded to its header alone, the way a file folds to its own. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) return;

    const measure = () => setHeaderHeight(element.getBoundingClientRect().height);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [group.title, group.summary]);

  return (
    <div className="flex flex-col" style={{ '--diff-sticky-offset': `${headerHeight}px` } as CSSProperties}>
      {/* One line, at the height of a file header: the two pin one above the
          other, and the rail beside them lists its actions on the same unit,
          so the whole band across the seam is level. A summary is free text —
          it truncates rather than setting the height of everything else.

          The whole line folds it. A part of a change is read and finished with
          the same way a file is, and nothing else in this header competes for
          the press. */}
      <div ref={headerRef} className="pane-ledge-raised sticky top-0 z-20 bg-surface">
        <button
          type="button"
          aria-expanded={!collapsed}
          title={collapsed ? `${group.title} — click to unfold` : `Fold ${group.title} away`}
          className="w-full flex items-center gap-2 h-9 px-3 text-left transition-colors duration-150 ease-out hover:bg-ink/5"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <Icon name={collapsed ? 'caret-right' : 'caret-down'} className="shrink-0 !w-3 !h-3 text-ink/40" />
          <Icon name="aperture" className={`shrink-0 w-3.5 h-3.5 ${collapsed ? 'text-accent/40' : 'text-accent/70'}`} />
          <span className={`shrink-0 text-[12px] font-medium ${collapsed ? 'text-ink/45' : 'text-text-primary'}`}>
            {group.title}
          </span>
          {group.summary && (
            <span className="min-w-0 truncate text-[11px] text-text-tertiary" title={group.summary}>
              {group.summary}
            </span>
          )}
          {/* Folded, the part has to say what is inside it — otherwise the only
              way to know what you skipped is to unfold it again. */}
          {collapsed && (
            <span className="ml-auto shrink-0 font-mono text-[11px] text-ink/35">
              {group.slices.length} {group.slices.length === 1 ? 'file' : 'files'}
            </span>
          )}
        </button>
      </div>
      {collapsed ? null : children}
    </div>
  );
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
  { projectPath, detail, only, groups },
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

  // The same order the rail lists them in. Without this the document runs in
  // whatever order the file list arrived and the two disagree the moment a
  // directory's files are not contiguous in it.
  const ordered = useMemo(() => inTreeOrder(files), [files]);
  const shown = only ? ordered.filter((f) => f.path === only) : ordered;

  /**
   * Sliced diffs, kept identical across renders while their source is.
   *
   * Narrowing a file to one part of a lens builds a new `FileDiff`,
   * and doing that inside the render meant a different object every time —
   * which the tokenizer reads as a different file, so a lens re-highlighted the
   * entire pull request on every render. Slicing reuses the underlying hunk
   * objects, so holding the wrapper steady is all that is needed.
   */
  const sliceCache = useRef(
    new Map<string, { source: FileDiff | null | undefined; result: FileDiff | null | undefined }>(),
  );
  useEffect(() => {
    sliceCache.current.clear();
  }, [detail.number]);

  const sliceFor = useCallback((path: string, source: FileDiff | null | undefined, hunks?: number[]) => {
    if (!source || !hunks) return source;
    const key = `${path}\u0000${hunks.join(',')}`;
    const cached = sliceCache.current.get(key);
    if (cached && cached.source === source) return cached.result;
    const result = sliceDiff(source, hunks);
    sliceCache.current.set(key, { source, result });
    return result;
  }, []);

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

  // A lens rearranges the whole document, so it applies only when the whole
  // document is what's on screen. Reading one file is already the narrowest
  // view there is; grouping a single file would be grouping nothing.
  const grouped = !only ? groups : null;
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
            <LensGroup
              key={group.title}
              group={group}
              collapsed={collapsed.has(group.title)}
              onCollapsedChange={(next) => useGithubStore.getState().setGroupCollapsed(group.title, next)}
            >
              {group.slices.map((slice) => {
                const file = byPath.get(slice.path);
                return file ? renderFile(file, `${group.title}:${slice.path}`, slice.hunks) : null;
              })}
            </LensGroup>
          ))
        : shown.map((file) => renderFile(file))}

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
