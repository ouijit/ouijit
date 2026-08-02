import { useState } from 'react';
import type { MergeMethod, PullRequestDetail } from '../../github/types';
import { Icon } from '../terminal/Icon';

interface MergeBoxProps {
  detail: PullRequestDetail;
  onMerge: (method: MergeMethod, deleteBranch: boolean) => Promise<void>;
}

const METHODS: Array<{ value: MergeMethod; label: string }> = [
  { value: 'squash', label: 'Squash and merge' },
  { value: 'merge', label: 'Create a merge commit' },
  { value: 'rebase', label: 'Rebase and merge' },
];

/**
 * Merge, with the blockers listed above the button rather than surfaced as a
 * failure after pressing it. The button stays clickable when the only blockers
 * are advisory (GitHub is the authority on whether a merge is actually allowed,
 * and branch protection rules we can't see may permit or forbid it) — but you
 * always see what is standing in the way first.
 */
export function MergeBox({ detail, onMerge }: MergeBoxProps) {
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);

  if (detail.state !== 'open') return null;

  const hardBlock = detail.merge.mergeable === 'CONFLICTING' || detail.isDraft;
  const blockers = detail.merge.blockers;

  const merge = async () => {
    setBusy(true);
    try {
      await onMerge(method, deleteBranch);
    } finally {
      setBusy(false);
    }
  };

  return (
    // No border of its own: this already sits in the frame's footer strip,
    // above the hairline that separates it from the conversation.
    <div className="flex flex-col gap-2">
      {blockers.length > 0 && (
        <ul className="flex flex-col gap-1">
          {blockers.map((blocker) => (
            <li key={blocker} className="flex items-center gap-1.5 font-mono text-[10px] text-text-secondary">
              <Icon name="warning" className="w-3 h-3 shrink-0 text-vcs-modified" />
              {blocker}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as MergeMethod)}
          className="font-mono text-[11px] bg-terminal-inset border border-ink/10 rounded-md px-2 py-1.5 text-text-primary outline-none focus:border-accent"
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 font-mono text-[11px] text-text-secondary">
          <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
          Delete branch
        </label>

        <button
          type="button"
          disabled={busy || hardBlock}
          title={
            detail.isDraft
              ? 'Mark the pull request ready for review first'
              : detail.merge.mergeable === 'CONFLICTING'
                ? 'Resolve the conflicts first'
                : undefined
          }
          className="ml-auto font-mono text-[11px] leading-none px-3 py-1.5 rounded-full bg-vcs-added/20 text-vcs-added hover:bg-vcs-added/30 disabled:opacity-40"
          onClick={() => void merge()}
        >
          {busy ? 'Merging…' : 'Merge pull request'}
        </button>
      </div>
    </div>
  );
}
