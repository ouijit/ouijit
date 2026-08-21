import { useState } from 'react';
import type { CommentKind } from '../../github/types';
import { useGithubStore } from '../../stores/githubStore';
import { useProjectStore } from '../../stores/projectStore';

interface CommentActionsProps {
  url?: string;
  /** Set only when GitHub says this viewer may delete it. */
  deletable?: { kind: CommentKind; commentId: number };
}

/**
 * Per-comment actions, revealed on hover. Deleting confirms first, since GitHub
 * cannot undo it. Whether it is offered comes from `viewerCanDelete` on the
 * detail query, which accounts for repo permissions a login comparison misses.
 */
export function CommentActions({ url, deletable }: CommentActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!url && !deletable) return null;

  const remove = async () => {
    const projectPath = useGithubStore.getState().projectPath;
    if (!deletable || !projectPath || busy) return;
    setBusy(true);
    try {
      const result = await window.api.github.deleteComment(projectPath, deletable.kind, deletable.commentId);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not delete the comment', 'error');
        setConfirming(false);
        return;
      }
      await useGithubStore.getState().reloadOpen(projectPath);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      className={`flex items-center gap-3 shrink-0 text-[13px] transition-opacity duration-100 ${
        confirming ? '' : 'opacity-0 group-hover/comment:opacity-100 focus-within:opacity-100'
      }`}
    >
      {confirming ? (
        <>
          <span>Delete this comment?</span>
          <Action label={busy ? 'Deleting…' : 'Delete'} danger onClick={() => void remove()} />
          <Action label="Cancel" onClick={() => setConfirming(false)} />
        </>
      ) : (
        <>
          {url && <Action label="View on GitHub" onClick={() => void window.api.openExternal(url)} />}
          {deletable && <Action label="Delete" onClick={() => setConfirming(true)} />}
        </>
      )}
    </span>
  );
}

function Action({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`transition-colors duration-100 ${danger ? 'text-error hover:opacity-80' : 'hover:text-text-primary'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
