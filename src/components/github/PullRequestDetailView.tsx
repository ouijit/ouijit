import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PullRequestDetail, ReviewDraft } from '../../github/types';
import type { LensSummary } from '../../lens/config';
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
 * One pull request: a chrome bar naming it, three panes, and the actions.
 *
 * Summary is what the change claims to be, Timeline is what has been said about
 * it, Code is the diff. Only Code needs a file rail, so only Code has one —
 * the other two get the full width for prose.
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

  /**
   * Take the reader to a file rather than showing them that file alone.
   *
   * The rail is a way through the document, not a filter on it: a diff is read
   * in order, and a click that threw the rest of the change away made the file
   * before and the file after unreachable without going back to the list.
   */
  const scrollToFile = useCallback((path: string | null, group?: string) => {
    const container = paneRef.current;
    if (!path) {
      if (container) container.scrollTop = 0;
      return;
    }
    useGithubStore.getState().setActivePath(path);
    scrollToSection(container, fileSelector(path, group));
  }, []);

  /**
   * What refreshing would do, found out by pointing at the button.
   *
   * Nothing polls GitHub, so a pull request updated while you read it looks
   * exactly like one that has not been — and pressing refresh to find out costs
   * the whole detail fetch and throws away your place in the document. The
   * question is asked here instead, on hover, with four fields.
   *
   * Asked again every time it is pointed at. The tooltip's own delay is the
   * debounce — reaching this at all means the pointer was held still on the
   * button — and an answer kept from a minute ago would be the thing this was
   * built to stop: something that looks live and is not.
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

  // What was true of the pull request that was on screen is not an answer about
  // the one that is now.
  useEffect(() => setRefreshTip(undefined), [detail.number, detail.headSha, detail.updatedAt]);

  // A pending comment lives on a line in a file, so jumping to one means the
  // code pane, showing that file. The jump is usually made from Summary or
  // Timeline, where `FilesSection` is not mounted and the ref is still null —
  // so the draft is remembered and opened once the pane it lives on exists.
  const [pendingDraft, setPendingDraft] = useState<{ id: string; path: string } | null>(null);

  const jumpToDraft = useCallback((draft: ReviewDraft) => {
    setPane('code');
    setPendingDraft({ id: draft.id, path: draft.path });
  }, []);

  useEffect(() => {
    if (pane !== 'code' || !pendingDraft) return;
    scrollToFile(pendingDraft.path);
    filesRef.current?.editDraft(pendingDraft.id);
    setPendingDraft(null);
  }, [pane, pendingDraft, scrollToFile]);

  const [lensesOpen, setLensesOpen] = useState(false);

  // The project's lenses, for the picker to offer alongside the file list.
  // Read here rather than in the rail so the dialog that edits them can hand
  // back an up-to-date list on the way out.
  const { lenses, reload: loadLenses } = useProjectLenses(projectPath);

  // The tree order is the file list's, not the diffs' — kept out of the
  // resolution below so it is not rebuilt once per arriving batch.
  const fileOrder = useMemo(() => treeFileOrder(files), [files]);

  /**
   * This pull request's lens, bound once where both the rail and the document
   * read the same result.
   *
   * A run is one call: main assembles the title, description and diff, asks the
   * agent once, and stores what comes back — there is no session, no terminal,
   * and nothing for the agent to go and look up. The rest is the same session a
   * worktree diff has, keyed here to the pull request rather than the head, so
   * a run outlives closing the pane to go and look at something else.
   */
  const lens = useLensSession(
    {
      key: `pr:${detail.number}`,
      revision: detail.headSha,
      read: () => window.api.github.lens(projectPath, detail.number, detail.headSha),
      write: (lensName) => window.api.github.runLens(projectPath, detail.number, lensName),
      subscribe: (refresh) => {
        // A lens written by an agent over the CLI, in another process, that
        // nothing here can otherwise see — shown as soon as it lands, since
        // someone paid for the run.
        const written = window.api.github.onLensChanged((payload) => {
          if (payload.projectPath === projectPath && payload.prNumber === detail.number) refresh(true);
        });
        // A rename changes what it is called and nothing about what the reader
        // chose to look at.
        const renamed = window.api.lens.onRenamed((payload) => {
          if (payload.projectPath === projectPath) refresh(false);
        });
        return () => {
          written();
          renamed();
        };
      },
    },
    diffs,
    fileOrder,
  );

  const runLens = useCallback(
    (picked: LensSummary) => {
      setLensesOpen(false);
      void lens.run(picked.name);
    },
    [lens],
  );

  const resolved = lens.resolved;
  const lensOn = lens.lensOn;

  /**
   * The anchors the observer below watches, as a value that only changes when
   * they do.
   *
   * `resolved` is a fresh array every time a batch of diffs lands — thirty
   * times over a long pull request — and keying the effect on it tore the
   * observer down and rebuilt it over every anchor in the pane each time.
   */
  const anchorShape = useMemo(() => {
    if (lensOn && resolved) {
      return resolved.map((group) => `${group.title}\t${group.slices.map((s) => s.path).join(',')}`).join('\n');
    }
    return fileOrder.join('\n');
  }, [lensOn, resolved, fileOrder]);

  /**
   * Follow the reader down the document, so the rail marks where they are.
   *
   * Written straight to the store rather than held here: this fires as the
   * document is scrolled, and state in this component would re-render the whole
   * diff to move a highlight in the rail.
   *
   * The anchors are the placeholders, which exist whether or not their file has
   * mounted yet, so this observes a stable set. Nested anchors are skipped — a
   * mounted file has one on its section too, and the wrapper is the one that
   * holds a place in the scroll.
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
        // The highest of what is on screen is the one being read: a file
        // running off the top of the pane is still the file you are in.
        let topmost: HTMLElement | null = null;
        let highest = Infinity;
        for (const anchor of onScreen) {
          const top = anchor.getBoundingClientRect().top;
          if (top < highest) {
            highest = top;
            topmost = anchor;
          }
        }
        if (topmost?.dataset.path) useGithubStore.getState().setActivePath(topmost.dataset.path);
      },
      // Only the top of the pane counts as where you are — otherwise the last
      // file of a long scroll claims it from the bottom of the screen.
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
        {/* Only the code pane has a rail, so only it has a seam. Summary and
            timeline are prose and take the full width. */}
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
        {/* Only the diff sits in a well — summary and timeline are prose, and
            prose in a trough reads as a form field. */}
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
          onRun={runLens}
          running={lens.writing}
          onClose={() => {
            setLensesOpen(false);
            // Whatever was added, renamed or deleted in there is what the
            // picker should offer next time it is opened.
            loadLenses();
          }}
        />
      )}
    </div>
  );
}
