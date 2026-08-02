import { useState } from 'react';
import type { MergeMethod, PullRequestDetail, ReviewDraft, ReviewEvent } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';

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
 * had to go elsewhere to approve. Comments written but not sent were likewise
 * only visible on one of the two. Here the count of unsent work is the leftmost
 * thing on the bar and never goes away while it is owed.
 *
 * Merge blockers are listed above the button rather than surfaced as a failure
 * after pressing it. The button stays live when the only blockers are advisory,
 * since GitHub is the authority on whether a merge is allowed and branch
 * protection we can't see may permit or forbid it.
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
          className="max-h-40 overflow-y-auto"
          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        >
          {drafts.map((draft) => (
            <div key={draft.id} className="flex items-start gap-2 px-3 py-2 hover:bg-ink/[0.03]">
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
                <span className="block text-[13px] text-text-secondary truncate mt-0.5">{draft.body}</span>
              </button>
              <button
                type="button"
                className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-text-tertiary hover:text-error hover:bg-ink/[0.06] transition-colors duration-100"
                title="Discard this comment"
                onClick={() => void discardDraft(draft)}
              >
                <Icon name="x" className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="px-3 py-2">
            <textarea
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Review summary (optional)"
              className="w-full text-sm bg-terminal-inset border border-ink/10 rounded-md px-2 py-1.5 text-text-primary outline-none focus:border-accent resize-y"
            />
          </div>
        </div>
      )}

      {blockers.length > 0 && (
        <ul
          className="flex flex-col gap-1 px-3 py-2"
          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
        >
          {blockers.map((blocker) => (
            <li key={blocker} className="flex items-center gap-1.5 font-mono text-[10px] text-text-secondary">
              <Icon name="warning" className="w-3 h-3 shrink-0 text-vcs-modified" />
              {blocker}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        {drafts.length > 0 ? (
          <button
            type="button"
            className="flex items-center gap-1.5 font-mono text-[11px] leading-none px-2.5 py-1.5 rounded-full text-accent transition-colors duration-100"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
            onClick={() => setDraftsOpen(!draftsOpen)}
          >
            <Icon name={draftsOpen ? 'caret-down' : 'caret-up'} className="w-3 h-3" />
            {drafts.length} unsent {drafts.length === 1 ? 'comment' : 'comments'}
          </button>
        ) : (
          <span className="font-mono text-[11px] text-text-tertiary">Comment on a line to start a review</span>
        )}

        <span className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn-secondary btn-compact"
            disabled={submitting}
            onClick={() => void submitReview('COMMENT')}
          >
            Comment
          </button>
          <button
            type="button"
            className="btn-success btn-compact"
            disabled={submitting || detail.isMine}
            title={detail.isMine ? 'GitHub does not allow approving your own pull request' : undefined}
            onClick={() => void submitReview('APPROVE')}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn-danger btn-compact"
            disabled={submitting || detail.isMine}
            title={detail.isMine ? 'GitHub does not allow requesting changes on your own pull request' : undefined}
            onClick={() => void submitReview('REQUEST_CHANGES')}
          >
            Request changes
          </button>

          {isOpen && (
            <>
              <span className="w-px h-5 bg-ink/[0.08]" />
              <MergeControl
                method={method}
                onMethodChange={setMethod}
                deleteBranch={deleteBranch}
                onDeleteBranchChange={setDeleteBranch}
                disabled={merging || hardBlock}
                busy={merging}
                blockedReason={
                  detail.isDraft
                    ? 'Mark the pull request ready for review first'
                    : detail.merge.mergeable === 'CONFLICTING'
                      ? 'Resolve the conflicts first'
                      : undefined
                }
                onMerge={() => void merge()}
              />
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Merge as one control: the button does the common thing, and the caret opens
 * the choices. A select sitting permanently beside the button would give a
 * rarely-changed setting the same weight as the action itself.
 */
function MergeControl({
  method,
  onMethodChange,
  deleteBranch,
  onDeleteBranchChange,
  disabled,
  busy,
  blockedReason,
  onMerge,
}: {
  method: MergeMethod;
  onMethodChange: (method: MergeMethod) => void;
  deleteBranch: boolean;
  onDeleteBranchChange: (value: boolean) => void;
  disabled: boolean;
  busy: boolean;
  blockedReason?: string;
  onMerge: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = METHODS.find((m) => m.value === method)?.label ?? 'Merge';

  return (
    <span className="relative flex items-center">
      <button
        type="button"
        className="btn-success btn-compact !pr-2"
        disabled={disabled}
        title={blockedReason}
        onClick={onMerge}
      >
        {busy ? 'Merging…' : label}
        <span
          className="w-5 h-5 -mr-0.5 rounded-full flex items-center justify-center hover:bg-ink/10"
          role="button"
          tabIndex={0}
          title="Merge options"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          <Icon name="caret-down" className="w-3 h-3" />
        </span>
      </button>

      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-full right-0 mb-2 z-20 w-56 rounded-[12px] overflow-hidden bg-surface border border-bezel py-1"
            style={{ boxShadow: 'var(--shadow-menu)' }}
          >
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left text-text-secondary hover:bg-ink/[0.06] hover:text-text-primary"
                onClick={() => {
                  onMethodChange(m.value);
                  setOpen(false);
                }}
              >
                <Icon
                  name="check"
                  className={`w-3 h-3 shrink-0 ${m.value === method ? 'opacity-100 text-accent' : 'opacity-0'}`}
                />
                {m.label}
              </button>
            ))}
            <div className="my-1 h-px bg-ink/[0.08]" />
            <label className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(e) => onDeleteBranchChange(e.target.checked)}
                className="accent-accent"
              />
              Delete branch after merge
            </label>
          </div>
        </>
      )}
    </span>
  );
}
