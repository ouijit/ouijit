import { useState } from 'react';
import type { MergeMethod, PullRequestDetail, ReviewDraft, ReviewEvent } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { ActionMenu, MenuDivider, MenuField, MenuItem } from './ActionMenu';
import { SegmentedGroup } from './SegmentedGroup';

interface ReviewActionsProps {
  projectPath: string;
  detail: PullRequestDetail;
  /** Scroll the document to a pending comment and open it for editing. */
  onJumpToDraft: (draft: ReviewDraft) => void;
}

const METHODS: Array<{ value: MergeMethod; label: string }> = [
  { value: 'squash', label: 'Squash and merge' },
  { value: 'merge', label: 'Create a merge commit' },
  { value: 'rebase', label: 'Rebase and merge' },
];

/**
 * Everything you can do to a pull request, in the chrome bar beside the panes,
 * so it is reachable from all three rather than living on one of them.
 *
 * One joined, extruded control with exactly one accent segment. Verdicts sit
 * inside the review menu rather than on the bar as green and red buttons: those
 * two colours mean added and removed everywhere else in this app, and three
 * equally loud buttons made three unequal choices look alike. Comments written
 * but not sent get their own segment, dotted in accent, so unsent work is
 * visible from any pane.
 */
export function ReviewActions({ projectPath, detail, onJumpToDraft }: ReviewActionsProps) {
  const drafts = useGithubStore((s) => s.drafts);
  const submitting = useGithubStore((s) => s.submitting);

  const [summary, setSummary] = useState('');
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [merging, setMerging] = useState(false);

  const isOpen = detail.state === 'open';
  const hardBlock = detail.merge.mergeable === 'CONFLICTING' || detail.isDraft;
  const blockers = isOpen ? detail.merge.blockers : [];

  // GitHub rejects a COMMENT or REQUEST_CHANGES review with a blank body, even
  // one carrying inline comments. Said here rather than as a 422 after the fact.
  const needsSummary = !summary.trim();
  const summaryHint = 'GitHub needs a summary for this kind of review';

  const blockedReason = detail.isDraft
    ? 'Mark the pull request ready for review first'
    : detail.merge.mergeable === 'CONFLICTING'
      ? 'Resolve the conflicts first'
      : undefined;

  const submitReview = async (event: ReviewEvent) => {
    useGithubStore.getState().setSubmitting(true);
    try {
      const result = await window.api.github.submitReview(projectPath, detail.number, event, summary);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not submit the review', 'error');
        return;
      }
      useProjectStore.getState().addToast('Review submitted', 'success');
      setSummary('');
      await useGithubStore.getState().reloadDetail(projectPath);
    } finally {
      useGithubStore.getState().setSubmitting(false);
    }
  };

  const discardDraft = async (draft: ReviewDraft) => {
    await window.api.github.discardDraft(projectPath, draft.id);
    await useGithubStore.getState().loadDrafts(projectPath, detail.number);
  };

  const merge = async () => {
    setMerging(true);
    try {
      const result = await window.api.github.mergePr(projectPath, detail.number, method, deleteBranch);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Merge failed', 'error');
        return;
      }
      useProjectStore.getState().addToast(`Merged #${detail.number}`, 'success');
      await useGithubStore.getState().reloadDetail(projectPath);
      await useGithubStore.getState().loadInbox(projectPath);
    } finally {
      setMerging(false);
    }
  };

  return (
    <SegmentedGroup>
      {drafts.length > 0 && <DraftsPopover drafts={drafts} onJump={onJumpToDraft} onDiscard={discardDraft} />}
      <ActionMenu label={submitting ? 'Submitting…' : 'Review'} disabled={submitting} accent={!isOpen}>
        {(close) => (
          <>
            <MenuField>
              <textarea
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Summary"
                className="field resize-y"
              />
            </MenuField>
            <MenuDivider />
            <MenuItem
              label="Comment"
              hint={drafts.length > 0 ? `sends ${drafts.length}` : undefined}
              disabled={needsSummary}
              title={needsSummary ? summaryHint : undefined}
              onClick={() => {
                close();
                void submitReview('COMMENT');
              }}
            />
            <MenuItem
              label="Approve"
              disabled={detail.isMine}
              title={detail.isMine ? 'GitHub does not allow approving your own pull request' : undefined}
              onClick={() => {
                close();
                void submitReview('APPROVE');
              }}
            />
            <MenuItem
              label="Request changes"
              disabled={detail.isMine || needsSummary}
              title={
                detail.isMine
                  ? 'GitHub does not allow requesting changes on your own pull request'
                  : needsSummary
                    ? summaryHint
                    : undefined
              }
              onClick={() => {
                close();
                void submitReview('REQUEST_CHANGES');
              }}
            />
          </>
        )}
      </ActionMenu>

      {isOpen && (
        <ActionMenu label={merging ? 'Merging…' : 'Merge'} accent disabled={merging || hardBlock} title={blockedReason}>
          {(close) => (
            <>
              {/* Said before the press, not reported as a failure after
                      it. Advisory blockers still let the button through:
                      GitHub is the authority, and branch protection we cannot
                      see may permit or forbid the merge. */}
              {blockers.length > 0 && (
                <ul className="px-2.5 py-1.5 flex flex-col gap-1">
                  {blockers.map((blocker) => (
                    <li key={blocker} className="flex items-start gap-1.5 text-[13px] text-text-tertiary">
                      <Icon name="warning" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-vcs-modified" />
                      {blocker}
                    </li>
                  ))}
                </ul>
              )}
              {blockers.length > 0 && <MenuDivider />}
              {METHODS.map((m) => (
                <MenuItem
                  key={m.value}
                  label={m.label}
                  selected={m.value === method}
                  onClick={() => setMethod(m.value)}
                />
              ))}
              <MenuDivider />
              <MenuItem
                label="Delete branch after merge"
                selected={deleteBranch}
                onClick={() => setDeleteBranch(!deleteBranch)}
              />
              <MenuDivider />
              <MenuField>
                <button
                  type="button"
                  className="btn-primary btn-compact w-full"
                  onClick={() => {
                    close();
                    void merge();
                  }}
                >
                  {METHODS.find((m) => m.value === method)?.label}
                </button>
              </MenuField>
            </>
          )}
        </ActionMenu>
      )}
    </SegmentedGroup>
  );
}

/** The unsent-comment count, and the list behind it. */
function DraftsPopover({
  drafts,
  onJump,
  onDiscard,
}: {
  drafts: ReviewDraft[];
  onJump: (draft: ReviewDraft) => void;
  onDiscard: (draft: ReviewDraft) => Promise<void>;
}) {
  return (
    <ActionMenu label={`${drafts.length} unsent`} dot>
      {(close) =>
        drafts.map((draft) => (
          <div key={draft.id} className="group flex items-start gap-1">
            <button
              type="button"
              className="flex-1 min-w-0 text-left px-2.5 py-1.5 rounded-[7px] hover:bg-ink/[0.08]"
              onClick={() => {
                close();
                onJump(draft);
              }}
            >
              <span className="block font-mono text-[11px] text-text-tertiary truncate">
                {draft.path}:{draft.line}
              </span>
              <span className="block text-[13px] text-text-secondary truncate">{draft.body}</span>
            </button>
            <button
              type="button"
              className="shrink-0 w-6 h-6 mt-1.5 rounded flex items-center justify-center text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity duration-100"
              title="Discard this comment"
              onClick={() => void onDiscard(draft)}
            >
              <Icon name="x" className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      }
    </ActionMenu>
  );
}
