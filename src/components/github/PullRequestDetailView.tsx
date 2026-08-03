import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestDetail, ReviewDraft } from '../../github/types';
import type { TaskWithWorkspace } from '../../types';
import { useGithubStore } from '../../stores/githubStore';
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
  const badge = stateBadge(detail);

  const filesRef = useRef<FilesSectionHandle>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Pane>('summary');
  const [file, setFile] = useState<string | null>(null);

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [pane, file]);

  // A pending comment lives on a line in a file, so jumping to one means the
  // code pane, showing that file.
  const jumpToDraft = useCallback((draft: ReviewDraft) => {
    setPane('code');
    setFile(draft.path);
    filesRef.current?.editDraft(draft.id);
  }, []);

  // A file that disappears under you — a force-push drops it from the diff —
  // would otherwise leave the pane empty with no way back.
  useEffect(() => {
    if (!file || files.length === 0) return;
    if (!files.some((f) => f.path === file)) setFile(null);
  }, [file, files]);

  return (
    <div className="flex flex-col flex-1 min-w-0">
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
        {pane === 'code' && <PullRequestRail detail={detail} files={files} activePath={file} onSelect={setFile} />}
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
            <FilesSection ref={filesRef} projectPath={projectPath} detail={detail} only={file} />
          )}
        </div>
      </div>
    </div>
  );
}
