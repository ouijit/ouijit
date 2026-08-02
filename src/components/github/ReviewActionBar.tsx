import { useState } from 'react';
import type { MergeMethod, PullRequestDetail, ReviewDraft, ReviewEvent } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { ActionMenu, MenuDivider, MenuField, MenuItem } from './ActionMenu';

interface ReviewActionBarProps {
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
 * Everything you can do to a pull request, in one strip that is always there.
 *
 * Splitting these across views was the old design's real failure: you finished
 * reading the diff and had to go elsewhere to merge, or read the discussion and
 * had to go elsewhere to approve, and comments written but not sent were only
 * visible on one of the two.
 *
 * Two controls, one of them accent. Verdicts sit inside the review menu rather
 * than on the bar as green and red buttons: those two colours mean added and
 * removed everywhere else in this app, and three equally loud buttons made
 * three unequal choices look alike.
 */
export function ReviewActionBar({ projectPath, detail, onJumpToDraft }: ReviewActionBarProps) {
  const drafts = useGithubStore((s) => s.drafts);
  const submitting = useGithubStore((s) => s.submitting);

  const [draftsOpen, setDraftsOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [merging, setMerging] = useState(false);

  const isOpen = detail.state === 'open';
  const hardBlock = detail.merge.mergeable === 'CONFLICTING' || detail.isDraft;
  const blockers = isOpen ? detail.merge.blockers : [];

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
      setDraftsOpen(false);
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
    <div
      className="shrink-0 flex flex-col"
      style={{ borderTop: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
    >
      {draftsOpen && drafts.length > 0 && (
        <div
          className="max-h-40 overflow-y-auto py-1"
          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        >
          {drafts.map((draft) => (
            <div key={draft.id} className="group flex items-start gap-2 px-3 py-1 hover:bg-ink/[0.03]">
              <button
                type="button"
                className="flex-1 min-w-0 text-left"
                onClick={() => {
                  onJumpToDraft(draft);
                  setDraftsOpen(false);
                }}
              >
                <span className="block font-mono text-[10px] text-text-tertiary truncate">
                  {draft.path}:{draft.line}
                </span>
                <span className="block text-[13px] text-text-secondary truncate">{draft.body}</span>
              </button>
              <button
                type="button"
                className="shrink-0 w-5 h-5 mt-0.5 rounded flex items-center justify-center text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity duration-100"
                title="Discard this comment"
                onClick={() => void discardDraft(draft)}
              >
                <Icon name="x" className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {blockers.length > 0 && (
        <ul
          className="flex flex-col gap-1 px-3 py-2"
          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        >
          {blockers.map((blocker) => (
            <li key={blocker} className="flex items-center gap-1.5 font-mono text-[10px] text-text-tertiary">
              <Icon name="warning" className="w-3 h-3 shrink-0 opacity-60" />
              {blocker}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {drafts.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1.5 font-mono text-[11px] leading-none px-2 py-1.5 rounded-full text-accent hover:bg-ink/[0.06] transition-colors duration-100"
            onClick={() => setDraftsOpen(!draftsOpen)}
          >
            <Icon
              name="caret-right"
              className={`w-3 h-3 transition-transform duration-150 ${draftsOpen ? 'rotate-90' : '-rotate-90'}`}
            />
            {drafts.length} unsent
          </button>
        )}

        <span className="ml-auto flex items-center gap-2">
          <ActionMenu
            label={submitting ? 'Submitting…' : 'Review'}
            disabled={submitting}
            variant={isOpen ? 'secondary' : 'primary'}
          >
            {(close) => (
              <>
                <MenuField>
                  <textarea
                    rows={3}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Summary (optional)"
                    className="w-full text-sm bg-terminal-inset border border-ink/10 rounded-md px-2 py-1.5 text-text-primary outline-none focus:border-accent resize-y"
                  />
                </MenuField>
                <MenuDivider />
                <MenuItem
                  label="Comment"
                  hint={drafts.length > 0 ? `sends ${drafts.length}` : undefined}
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
                  disabled={detail.isMine}
                  title={
                    detail.isMine ? 'GitHub does not allow requesting changes on your own pull request' : undefined
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
              variant="primary"
              disabled={merging || hardBlock}
              title={blockedReason}
            >
              {(close) => (
                <>
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
        </span>
      </div>
    </div>
  );
}
