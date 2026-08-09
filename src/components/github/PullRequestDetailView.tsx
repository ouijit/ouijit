import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PullRequestDetail, ReviewDraft } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore, RAIL_DEFAULT_WIDTH, RAIL_MIN_WIDTH, RAIL_MAX_WIDTH } from '../../stores/githubStore';
import { resolveLens } from '../../github/lens';
import { useProjectStore } from '../../stores/projectStore';
import type { LensSummary } from '../../github/service';
import { LensDialog } from '../dialogs/LensDialog';
import { ResizeHandle } from '../common/ResizeHandle';
import { treeFileOrder } from '../diff/DiffFileTree';
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

const STATE_TONE: Record<string, string> = {
  Merged: 'text-vcs-renamed',
  Closed: 'text-vcs-deleted',
  Draft: 'text-text-tertiary',
  Open: 'text-vcs-added',
};

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
  const lensGroups = useGithubStore((s) => s.lensGroups);
  const lensName = useGithubStore((s) => s.lensName);
  const lensOn = useGithubStore((s) => s.lensOn);
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
  // Only this pull request's run is this pull request's business.
  const lensRun = useGithubStore((s) => s.lensRun);
  const lensWriting = lensRun?.prNumber === detail.number ? lensRun.name : null;

  // The project's lenses, for the picker to offer alongside the file list.
  // Read here rather than in the rail so the dialog that edits them can hand
  // back an up-to-date list on the way out.
  const [lenses, setLenses] = useState<LensSummary[]>([]);
  const loadLenses = useCallback(() => {
    void window.api.github.listLenses(projectPath).then(setLenses);
  }, [projectPath]);

  useEffect(() => loadLenses(), [loadLenses]);

  /**
   * Read this pull request through one of the project's lenses.
   *
   * One call. Main assembles the title, description and diff, asks the agent
   * once, and stores what comes back — there is no session, no terminal, and
   * nothing for the agent to go and look up.
   *
   * The lens is loaded here on success rather than waited for: this call knows
   * it finished, so being told by a push would be indirection standing in for
   * something already known. The push exists for the other writer — an agent
   * using the CLI, in another process, that nothing here can see.
   */
  const writeLens = useCallback(
    (lens: LensSummary) => {
      const prNumber = detail.number;
      const headSha = detail.headSha;
      useGithubStore.getState().setLensRun({ prNumber, name: lens.name });
      setLensesOpen(false);

      void window.api.github
        .runLens(projectPath, prNumber, lens.name)
        .then(async (result) => {
          if (!result.success) {
            useProjectStore.getState().addToast(result.error ?? `“${lens.name}” could not read this change`, 'error');
            return;
          }
          await useGithubStore.getState().loadLens(projectPath, prNumber, headSha);
        })
        .catch((error: unknown) => {
          useProjectStore.getState().addToast(error instanceof Error ? error.message : String(error), 'error');
        })
        .finally(() => {
          // Whatever happened, it is no longer happening. Clearing only on
          // success is how a failed run leaves a spinner turning for ever.
          const current = useGithubStore.getState().lensRun;
          if (current?.prNumber === prNumber && current.name === lens.name) {
            useGithubStore.getState().setLensRun(null);
          }
        });
    },
    [projectPath, detail.number, detail.headSha],
  );

  // Bound once, where both the rail and the document can read the same result.
  // Resolution needs the parsed diffs, so it waits for them: until they land the
  // lens has nothing to point at.
  const resolved = useMemo(
    () => (lensGroups ? resolveLens(lensGroups, diffs, treeFileOrder(files)) : null),
    [lensGroups, diffs, files],
  );

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
  }, [pane, files, resolved, lensOn, collapsedGroups]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <DetailChrome
        icon={badge.icon}
        tone={STATE_TONE[badge.label]}
        title={detail.title}
        url={detail.url}
        busy={detailLoading}
        onRefresh={() => void useGithubStore.getState().reloadDetail(projectPath)}
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
              lensName={lensName}
              lensOn={lensOn}
              onLensOn={(on) => useGithubStore.getState().setLensOn(on)}
              lenses={lenses}
              onRunLens={writeLens}
              onOpenLenses={() => setLensesOpen(true)}
              lensWriting={lensWriting}
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
        <div ref={paneRef} className="flex-1 min-w-0 overflow-y-auto">
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
            <FilesSection ref={filesRef} projectPath={projectPath} detail={detail} groups={lensOn ? resolved : null} />
          )}
        </div>
      </div>

      {lensesOpen && (
        <LensDialog
          projectPath={projectPath}
          onRun={writeLens}
          running={lensWriting}
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
