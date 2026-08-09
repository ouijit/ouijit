import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PullRequestDetail, ReviewDraft } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore, RAIL_DEFAULT_WIDTH, RAIL_MIN_WIDTH, RAIL_MAX_WIDTH } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { addProjectTerminal } from '../terminal/terminalActions';
import { prCommandEnv } from '../../github/prCommandEnv';
import { resolveLens } from '../../github/lens';
import { ResizeHandle } from '../common/ResizeHandle';
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
  const lensOn = useGithubStore((s) => s.lensOn);
  const railWidth = useGithubStore((s) => s.railWidth);
  const badge = stateBadge(detail);

  const filesRef = useRef<FilesSectionHandle>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Pane>('summary');
  const [file, setFile] = useState<string | null>(null);

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [pane, file]);

  // A pending comment lives on a line in a file, so jumping to one means the
  // code pane, showing that file. The jump is usually made from Summary or
  // Timeline, where `FilesSection` is not mounted and the ref is still null —
  // so the draft is remembered and opened once the pane it lives on exists.
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);

  const jumpToDraft = useCallback((draft: ReviewDraft) => {
    setPane('code');
    setFile(draft.path);
    setPendingDraftId(draft.id);
  }, []);

  useEffect(() => {
    if (pane !== 'code' || !pendingDraftId) return;
    filesRef.current?.editDraft(pendingDraftId);
    setPendingDraftId(null);
  }, [pane, pendingDraftId, file]);

  // The reading-order command is a project setting, read once the pane opens so
  // the rail knows whether it is offering to run one or to choose one.
  const [lensCommand, setLensCommand] = useState('');
  const [lensWriting, setLensWriting] = useState(false);
  useEffect(() => {
    void window.api.github.lensCommand(projectPath).then(setLensCommand);
  }, [projectPath]);

  /**
   * Hand this pull request to the reading-order command.
   *
   * Nothing configured yet means the press is about choosing one, so it goes to
   * settings — the same control, doing the next thing that has to happen either
   * way, rather than two controls a reader has to tell apart.
   */
  const writeLens = useCallback(() => {
    if (!lensCommand) {
      useProjectStore.getState().setActivePanel('settings');
      return;
    }
    if (!detail) return;
    setLensWriting(true);
    void addProjectTerminal(
      projectPath,
      { name: 'Reading order', command: lensCommand, source: 'custom', priority: 0 },
      {
        ...(linkedTask?.worktreePath
          ? {
              existingWorktree: {
                path: linkedTask.worktreePath,
                branch: linkedTask.branch || '',
                createdAt: linkedTask.createdAt,
              },
              taskId: linkedTask.taskNumber,
            }
          : {}),
        skipAutoHook: true,
        extraEnv: prCommandEnv(detail, linkedTask?.worktreePath),
      },
    ).finally(() => setLensWriting(false));
  }, [lensCommand, detail, projectPath, linkedTask]);

  // Bound once, where both the rail and the document can read the same result.
  // Resolution needs the parsed diffs, so it waits for them: until they land the
  // lens has nothing to point at.
  const resolved = useMemo(
    () =>
      lensGroups
        ? resolveLens(
            lensGroups,
            diffs,
            files.map((f) => f.path),
          )
        : null,
    [lensGroups, diffs, files],
  );

  // A file that disappears under you — a force-push drops it from the diff —
  // would otherwise leave the pane empty with no way back.
  useEffect(() => {
    if (!file || files.length === 0) return;
    if (!files.some((f) => f.path === file)) setFile(null);
  }, [file, files]);

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
        actions={
          <ReviewActions
            projectPath={projectPath}
            detail={detail}
            linkedTask={linkedTask}
            onJumpToDraft={jumpToDraft}
          />
        }
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
              activePath={file}
              onSelect={setFile}
              groups={resolved}
              lensOn={lensOn}
              onLensOn={(on) => useGithubStore.getState().setLensOn(on)}
              onWriteLens={writeLens}
              hasLensCommand={Boolean(lensCommand)}
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
            <FilesSection
              ref={filesRef}
              projectPath={projectPath}
              detail={detail}
              only={file}
              groups={lensOn ? resolved : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
