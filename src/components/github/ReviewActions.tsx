import { useState } from 'react';
import type { MergeMethod, PullRequestDetail, ReviewDraft, ReviewEvent } from '../../github/types';
import { reviewSubmitProblem } from '../../github/reviewRules';
import { describeLines } from '../../diffAnchor';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { PendingRow } from '../ui/PendingRow';
import { ActionMenu } from '../ui/ActionMenu';
import { MenuDivider, MenuField, MenuItem } from '../ui/Menu';
import { SegmentedGroup } from '../ui/SegmentedGroup';

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
 * Verdicts sit inside the review menu rather than on the bar as green and red
 * buttons, which mean added and removed everywhere else in this app.
 */
export function ReviewActions({ projectPath, detail, onJumpToDraft }: ReviewActionsProps) {
  const drafts = useGithubStore((s) => s.drafts);
  const submitting = useGithubStore((s) => s.submitting);

  const [summary, setSummary] = useState('');
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [bypassRequested, setBypassRequested] = useState(false);
  const [merging, setMerging] = useState(false);

  const isOpen = detail.state === 'open';
  const blockers = isOpen ? detail.merge.blockers : [];
  // bypassRequested outlives the row that set it: a reload that clears the
  // blockers hides the toggle without unsetting it.
  const bypass = detail.merge.canBypass && bypassRequested;

  // Said here rather than as a 422 after the fact, and asked of the same
  // function main asks before it sends.
  const unplaceable = drafts.filter((d) => d.unplaceable).length;
  const problem = (event: ReviewEvent) => reviewSubmitProblem(event, summary, drafts.length, unplaceable);
  const commentProblem = problem('COMMENT');
  const changesProblem = problem('REQUEST_CHANGES');
  // An approval may be wordless, but it still carries the inline comments up
  // with it, so a stranded one sinks it the same way.
  const approveProblem = problem('APPROVE');

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
      // The sidebar's unsent count comes from the inbox, not from the detail —
      // without this the row goes on advertising comments that have been sent
      // until the next poll tick.
      await useGithubStore.getState().loadInbox(projectPath);
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
      const result = await window.api.github.mergePr(projectPath, detail.number, { method, deleteBranch, bypass });
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
              disabled={Boolean(commentProblem)}
              title={commentProblem ?? undefined}
              onClick={() => {
                close();
                void submitReview('COMMENT');
              }}
            />
            <MenuItem
              label="Approve"
              disabled={detail.isMine || Boolean(approveProblem)}
              title={
                detail.isMine ? 'GitHub does not allow approving your own pull request' : (approveProblem ?? undefined)
              }
              onClick={() => {
                close();
                void submitReview('APPROVE');
              }}
            />
            <MenuItem
              label="Request changes"
              disabled={detail.isMine || Boolean(changesProblem)}
              title={
                detail.isMine
                  ? 'GitHub does not allow requesting changes on your own pull request'
                  : (changesProblem ?? undefined)
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
        <ActionMenu
          label={merging ? 'Merging…' : 'Merge'}
          accent
          disabled={merging || detail.merge.hardBlock != null}
          title={detail.merge.hardBlock ?? undefined}
        >
          {(close) => (
            <>
              {/* Advisory blockers still let the button through: GitHub is the
                  authority, and branch protection we cannot see may permit or
                  forbid the merge. */}
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
              {detail.merge.canBypass && (
                <MenuItem
                  label="Merge without meeting requirements"
                  selected={bypassRequested}
                  onClick={() => setBypassRequested(!bypassRequested)}
                />
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
          <PendingRow
            key={draft.id}
            path={draft.path}
            line={describeLines(draft.startLine, draft.line)}
            body={draft.body}
            discardTitle="Discard this comment"
            /* A review goes up under your name, so anything you did not type
               is marked. The origin is a caller-supplied name, so it is
               clamped. Being stranded outranks it: that one blocks the send. */
            badge={
              draft.unplaceable ? (
                <span className="shrink-0 px-1 rounded bg-error/15 text-error">not in the diff</span>
              ) : draft.origin !== 'human' ? (
                <span className="shrink-0 px-1 rounded bg-ink/[0.08] text-text-secondary">
                  {draft.origin.slice(0, 16)}
                </span>
              ) : undefined
            }
            onJump={() => {
              close();
              onJump(draft);
            }}
            onDiscard={() => void onDiscard(draft)}
          />
        ))
      }
    </ActionMenu>
  );
}
