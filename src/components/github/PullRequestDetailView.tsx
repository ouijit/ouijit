import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestDetail, ReviewDraft } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore } from '../../stores/githubStore';
import { Icon } from '../terminal/Icon';
import { STATUS_LABELS } from '../kanban/taskMenu';
import { BoardChip, BoardLabels } from './BoardCard';
import { Entry, filePathOf, type PrSection } from './DocumentSection';
import { ChecksSection } from './ChecksSection';
import { DiscussionSection } from './DiscussionSection';
import { FilesSection, type FilesSectionHandle } from './FilesSection';
import { PullRequestRail } from './PullRequestRail';
import { ReviewActionBar } from './ReviewActionBar';
import { Markdown } from './Markdown';
import { RefreshButton } from './RefreshButton';
import { reviewDecisionLabel, since, stateBadge } from './prFormat';

interface PullRequestDetailViewProps {
  projectPath: string;
  detail: PullRequestDetail;
  /** Task already tracking this PR, when there is one. */
  linkedTask?: TaskWithWorkspace;
  /** What opening that task will do, so the chip can say so first. */
  openTaskLabel?: (task: TaskWithWorkspace) => string;
  onOpenTask: (task: TaskWithWorkspace) => void;
  onPromoteToTask: () => void;
}

const STATE_TONE: Record<string, string> = {
  Merged: 'var(--color-vcs-renamed)',
  Closed: 'var(--color-vcs-deleted)',
  Draft: 'var(--color-text-tertiary)',
  Open: 'var(--color-vcs-added)',
};

const DECISION_TONE: Record<string, string> = {
  Approved: 'var(--color-vcs-added)',
  'Changes requested': 'var(--color-vcs-deleted)',
  'Review required': 'var(--color-text-tertiary)',
};

/**
 * One pull request as one document.
 *
 * What it says, whether it builds, what has been said about it, then every file
 * in order — one scroll, one position, no view to be in the wrong one of. The
 * rail on the left indexes the whole thing rather than only the files, and the
 * bar at the bottom carries every action, so nothing you might want to do is
 * ever somewhere you are not.
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
  const badge = stateBadge(detail);
  const decision = reviewDecisionLabel(detail.reviewDecision);

  const filesRef = useRef<FilesSectionHandle>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<PrSection>('files');

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [section]);

  // A pending comment lives on a line in a file, so jumping to one means
  // showing that file. The pane is the whole point: there is nothing to scroll
  // past to reach it.
  const jumpToDraft = useCallback((draft: ReviewDraft) => {
    setSection(`file:${draft.path}`);
    filesRef.current?.editDraft(draft.id);
  }, []);

  // A file that disappears under you — a force-push drops it from the diff —
  // would otherwise leave the pane empty with no way back.
  const activePath = filePathOf(section);
  useEffect(() => {
    if (!activePath || files.length === 0) return;
    if (!files.some((f) => f.path === activePath)) setSection('files');
  }, [activePath, files]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="shrink-0 px-3 pt-2.5 pb-2.5">
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="w-6 h-6 shrink-0 rounded text-text-tertiary flex items-center justify-center hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150 [&>svg]:w-4 [&>svg]:h-4"
            title="Back to pull requests"
            onClick={() => useGithubStore.getState().closeDetail()}
          >
            <Icon name="caret-left" />
          </button>
          <h1 className="flex-1 font-mono text-sm font-medium text-text-primary min-w-0 break-words pt-0.5">
            {detail.title}
          </h1>
          <div className="flex items-center gap-1 shrink-0">
            {linkedTask ? (
              <button
                type="button"
                className="flex items-center gap-1.5 font-mono text-[11px] leading-none px-2 py-1.5 rounded-full text-text-secondary hover:text-text-primary transition-colors duration-100"
                style={{ background: 'color-mix(in srgb, var(--color-ink) 4%, transparent)' }}
                title={openTaskLabel ? `${openTaskLabel(linkedTask)} — ${linkedTask.name}` : linkedTask.name}
                onClick={() => onOpenTask(linkedTask)}
              >
                <span>T-{linkedTask.taskNumber}</span>
                <span className="opacity-50">{STATUS_LABELS[linkedTask.status] ?? linkedTask.status}</span>
                <Icon name="arrow-right" className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <button
                type="button"
                className="font-mono text-[11px] leading-none px-2.5 py-1.5 rounded-full text-text-secondary hover:text-text-primary transition-colors duration-100"
                style={{ background: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
                title="Create a task with a worktree at this pull request's head"
                onClick={onPromoteToTask}
              >
                Check out as task
              </button>
            )}
            <RefreshButton
              busy={detailLoading}
              onClick={() => void useGithubStore.getState().reloadDetail(projectPath)}
            />
            <button
              type="button"
              className="w-7 h-7 rounded-md text-text-secondary flex items-center justify-center hover:bg-ink/10 hover:text-text-primary transition-all duration-150 [&>svg]:w-4 [&>svg]:h-4"
              title="Open on GitHub"
              onClick={() => void window.api.openExternal(detail.url)}
            >
              <Icon name="arrow-square-out" />
            </button>
          </div>
        </div>

        {/* One line, not three. The state is worth a chip; the rest is text.
            Checks used to have a chip here too, which said the same thing the
            rail already says beside "Checks". */}
        <div className="flex items-center gap-2 flex-wrap mt-1.5 pl-8 font-mono text-[10px] leading-tight text-text-secondary">
          <BoardChip tone={STATE_TONE[badge.label]}>{badge.label}</BoardChip>
          {decision && <BoardChip tone={DECISION_TONE[decision.label]}>{decision.label}</BoardChip>}
          <span>#{detail.number}</span>
          <span className="opacity-30">·</span>
          <span>{detail.author}</span>
          <span className="opacity-30">·</span>
          <span>
            {detail.headRefName} <span className="opacity-40">into</span> {detail.baseRefName}
          </span>
          <span className="opacity-30">·</span>
          <span>{since(detail.updatedAt)}</span>
          {detail.labels.length > 0 && <BoardLabels labels={detail.labels} max={3} />}
        </div>
      </header>

      <div className="flex flex-1 min-h-0 border-t border-ink/[0.06]">
        <PullRequestRail detail={detail} files={files} section={section} onSelect={setSection} />

        {/* One pane, one part. The scroll resets on the way in — arriving
            partway down a diff you have not read is disorienting — but the
            pane is not keyed on the section, which would remount the file
            list and re-read every diff on each click. */}
        <div ref={paneRef} className="flex-1 min-w-0 overflow-y-auto">
          {section === 'description' ? (
            detail.body.trim() ? (
              <Entry author={detail.author} action={`opened this ${since(detail.createdAt)}`}>
                <Markdown body={detail.body} />
              </Entry>
            ) : (
              <p className="px-4 py-4 font-mono text-[11px] text-text-tertiary">No description was written</p>
            )
          ) : section === 'checks' ? (
            <ChecksSection checks={detail.checks} />
          ) : section === 'discussion' ? (
            <DiscussionSection projectPath={projectPath} detail={detail} />
          ) : (
            <FilesSection ref={filesRef} projectPath={projectPath} detail={detail} only={activePath} />
          )}
        </div>
      </div>

      <ReviewActionBar projectPath={projectPath} detail={detail} onJumpToDraft={jumpToDraft} />
    </div>
  );
}
