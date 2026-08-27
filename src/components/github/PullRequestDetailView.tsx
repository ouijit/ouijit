import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PullRequestDetail, ReviewDraft } from '../../github/types';
import type { LensSummary } from '../../lens/config';
import { partHolding, sectionKey } from '../../lens/lens';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore, RAIL_DEFAULT_WIDTH, RAIL_MIN_WIDTH, RAIL_MAX_WIDTH } from '../../stores/githubStore';
import { LensDialog } from '../dialogs/LensDialog';
import { ResizeHandle } from '../common/ResizeHandle';
import { treeFileOrder } from '../diff/DiffFileTree';
import { useProjectLenses } from '../diff/useProjectLenses';
import { useLensSession } from '../diff/useLensSession';
import { scrollToSection, fileSelector } from '../diff/scrollToSection';
import { Tab, TabBar } from './Tabs';
import { DetailChrome } from './DetailChrome';
import { DiscussionSection } from './DiscussionSection';
import { FilesSection, type FilesSectionHandle } from './FilesSection';
import { PullRequestRail } from './PullRequestRail';
import { ReviewActions } from './ReviewActions';
import { SummaryPane } from './SummaryPane';
import { stateBadge } from './prFormat';

interface PullRequestDetailViewProps {
  projectPath: string;
  detail: PullRequestDetail;
  linkedTask?: TaskWithWorkspace;
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onPromoteToTask: () => void;
}

type Pane = 'summary' | 'timeline' | 'code';

const PANES: Array<{ id: Pane; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'code', label: 'Code' },
];

/**
 * One pull request: a chrome bar naming it, three panes, and the actions. Only
 * the Code pane has a file rail.
 */
export function PullRequestDetailView({
  projectPath,
  detail,
  linkedTask,
  openTaskLabel,
  onOpenTask,
  onPromoteToTask,
}: PullRequestDetailViewProps) {
  const detailLoading = useGithubStore((s) => s.detailLoading);
  const files = useGithubStore((s) => s.files);
  const diffs = useGithubStore((s) => s.diffs);
  const railWidth = useGithubStore((s) => s.railWidth);
  const collapsedGroups = useGithubStore((s) => s.collapsedGroups);
  const badge = stateBadge(detail);

  const filesRef = useRef<FilesSectionHandle>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Pane>('summary');

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [pane]);

  /** The rail navigates the document; it never filters it. */
  const scrollToFile = useCallback((path: string | null, group?: string) => {
    const container = paneRef.current;
    if (!path) {
      if (container) container.scrollTop = 0;
      return;
    }
    useGithubStore.getState().setActiveSection(sectionKey(group, path));
    scrollToSection(container, fileSelector(path, group));
  }, []);

  /**
   * Nothing polls GitHub, so hovering refresh is how to find out whether there
   * is anything to pull without paying for the whole detail fetch. Re-asked on
   * every hover: a cached answer would be exactly the stale claim this avoids.
   */
  const [refreshTip, setRefreshTip] = useState<string | undefined>(undefined);
  const asking = useRef(false);

  const checkFreshness = useCallback(() => {
    if (detailLoading || asking.current) return;

    asking.current = true;
    setRefreshTip('Checking for changes…');
    void window.api.github
      .pullRequestFreshness(projectPath, detail.number)
      .then((remote) => {
        setRefreshTip(
          remote.headSha !== detail.headSha
            ? 'New commits — refresh to read them'
            : remote.updatedAt !== detail.updatedAt
              ? 'New activity — refresh to see it'
              : 'Up to date',
        );
      })
      // Silent: the button still refreshes, and a tooltip is the wrong place
      // to report that a network call failed.
      .catch(() => setRefreshTip(undefined))
      .finally(() => {
        asking.current = false;
      });
  }, [projectPath, detail.number, detail.headSha, detail.updatedAt, detailLoading]);

  // Clear it on a new pull request: the previous answer says nothing about it.
  useEffect(() => setRefreshTip(undefined), [detail.number, detail.headSha, detail.updatedAt]);

  // Jumping to a draft means the code pane, but the jump is usually made from
  // Summary or Timeline where `FilesSection` is unmounted and the ref is null.
  // Remember the draft and open it once that pane exists.
  const [pendingDraft, setPendingDraft] = useState<{ id: string; path: string; line: number } | null>(null);

  const jumpToDraft = useCallback((draft: ReviewDraft) => {
    setPane('code');
    setPendingDraft({ id: draft.id, path: draft.path, line: draft.line });
  }, []);

  const [lensesOpen, setLensesOpen] = useState(false);

  // Read here rather than in the rail so the dialog that edits them can hand
  // back an up-to-date list on the way out.
  const { lenses } = useProjectLenses(projectPath);

  // Ordered from the file list, not the diffs, so arriving batches do not
  // rebuild it.
  const fileOrder = useMemo(() => treeFileOrder(files), [files]);

  /**
   * This pull request's lens, bound once where both the rail and the document
   * read the same result. Keyed to the pull request rather than the head, so a
   * run outlives closing the pane to go and look at something else.
   */
  const lens = useLensSession(
    {
      key: `pr:${detail.number}`,
      revision: detail.headSha,
      read: () => window.api.github.lens(projectPath, detail.number, detail.headSha),
      write: (lensId) => window.api.github.runLens(projectPath, detail.number, lensId),
      // A lens written by an agent over the CLI, in another process, that
      // nothing here can otherwise see — shown as soon as it lands, since
      // someone paid for the run.
      subscribe: (refresh) =>
        window.api.github.onLensChanged((payload) => {
          if (payload.projectPath === projectPath && payload.prNumber === detail.number) refresh(true);
        }),
    },
    diffs,
    fileOrder,
  );

  const runLens = useCallback(
    (picked: LensSummary) => {
      void lens.run(picked);
    },
    [lens],
  );

  const resolved = lens.resolved;
  const lensOn = lens.lensOn;
  const shown = lens.shown;

  useEffect(() => {
    if (pane !== 'code' || !pendingDraft) return;
    // To the copy of the file that holds the line it is anchored to. A lens can
    // put that file in three parts, and only one of them is where the comment
    // is.
    const part = partHolding(shown, diffs.get(pendingDraft.path), pendingDraft.path, pendingDraft.line);
    scrollToFile(pendingDraft.path, part);
    filesRef.current?.editDraft(pendingDraft.id);
    setPendingDraft(null);
  }, [pane, pendingDraft, scrollToFile, shown, diffs]);

  /**
   * Changes only when the anchors do. `resolved` is a fresh array every time a
   * batch of diffs lands, and keying the observer effect on it rebuilds it over
   * every anchor in the pane each time.
   */
  const anchorShape = useMemo(() => {
    if (lensOn && resolved) {
      return resolved.map((group) => `${group.id}\t${group.slices.map((s) => s.path).join(',')}`).join('\n');
    }
    return fileOrder.join('\n');
  }, [lensOn, resolved, fileOrder]);

  /**
   * Marks where the reader is in the rail. Written straight to the store: this
   * fires on scroll, and component state would re-render the whole diff to move
   * a highlight. Observes the placeholder wrappers, which exist whether or not
   * their file has mounted; the nested anchor on a mounted section is skipped.
   */
  useEffect(() => {
    const container = paneRef.current;
    if (pane !== 'code' || !container || typeof IntersectionObserver === 'undefined') return;

    const anchors = Array.from(container.querySelectorAll<HTMLElement>('[data-path]')).filter(
      (anchor) => !anchor.parentElement?.closest('[data-path]'),
    );
    if (anchors.length === 0) return;

    const onScreen = new Set<HTMLElement>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const anchor = entry.target as HTMLElement;
          if (entry.isIntersecting) onScreen.add(anchor);
          else onScreen.delete(anchor);
        }
        // The topmost visible file is the one being read, even when it runs off
        // the top of the pane.
        let topmost: HTMLElement | null = null;
        let highest = Infinity;
        for (const anchor of onScreen) {
          const top = anchor.getBoundingClientRect().top;
          if (top < highest) {
            highest = top;
            topmost = anchor;
          }
        }
        // Which part of the change it sits in, not just which file: the same
        // file three parts down is a different place in the reading.
        if (topmost?.dataset.path) {
          const group = topmost.closest<HTMLElement>('[data-group]')?.dataset.group;
          useGithubStore.getState().setActiveSection(sectionKey(group, topmost.dataset.path));
        }
      },
      // Only the top band of the pane counts, or the last file of a long scroll
      // claims the mark from the bottom of the screen.
      { root: container, rootMargin: '0px 0px -60% 0px' },
    );
    for (const anchor of anchors) observer.observe(anchor);
    return () => observer.disconnect();
  }, [pane, anchorShape, collapsedGroups]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <DetailChrome
        icon={badge.icon}
        tone={badge.tone}
        title={detail.title}
        url={detail.url}
        busy={detailLoading}
        onRefresh={() => void useGithubStore.getState().reloadDetail(projectPath)}
        refreshTip={refreshTip}
        onRefreshHover={checkFreshness}
        onClose={() => useGithubStore.getState().closeDetail()}
        actions={<ReviewActions projectPath={projectPath} detail={detail} onJumpToDraft={jumpToDraft} />}
        tabs={
          <TabBar className="mx-auto shrink-0 self-stretch items-center">
            {PANES.map((p) => (
              <Tab
                key={p.id}
                active={pane === p.id}
                count={p.id === 'code' ? detail.changedFiles : undefined}
                onClick={() => setPane(p.id)}
              >
                {p.label}
              </Tab>
            ))}
          </TabBar>
        }
      />

      <div className="flex flex-1 min-h-0">
        {pane === 'code' && (
          <>
            <PullRequestRail
              width={railWidth}
              detail={detail}
              files={files}
              onSelect={scrollToFile}
              groups={resolved}
              onFile={lens.lens}
              lensOn={lensOn}
              onLensOn={lens.setLensOn}
              lenses={lenses}
              onRunLens={runLens}
              onOpenLenses={() => setLensesOpen(true)}
              lensWriting={lens.writing}
            />
            <ResizeHandle
              width={railWidth}
              onWidth={(width) => useGithubStore.getState().setRailWidth(width)}
              min={RAIL_MIN_WIDTH}
              max={RAIL_MAX_WIDTH}
              defaultWidth={RAIL_DEFAULT_WIDTH}
              label="Resize the changed files"
            />
          </>
        )}
        <div ref={paneRef} className={`flex-1 min-w-0 overflow-y-auto ${pane === 'code' ? 'diff-well' : ''}`}>
          {pane === 'summary' ? (
            <SummaryPane
              projectPath={projectPath}
              detail={detail}
              linkedTask={linkedTask}
              openTaskLabel={openTaskLabel}
              onOpenTask={onOpenTask}
              onPromoteToTask={onPromoteToTask}
            />
          ) : pane === 'timeline' ? (
            <DiscussionSection projectPath={projectPath} detail={detail} />
          ) : (
            <FilesSection ref={filesRef} projectPath={projectPath} detail={detail} groups={lens.shown} />
          )}
        </div>
      </div>

      {lensesOpen && (
        <LensDialog
          projectPath={projectPath}
          onCreated={runLens}
          running={lens.writing?.id ?? null}
          onClose={() => setLensesOpen(false)}
        />
      )}
    </div>
  );
}
