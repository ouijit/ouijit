import { useState } from 'react';
import type { LinearCommentDraft } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';
import { useProjectStore } from '../../stores/projectStore';
import { Markdown } from '../issues/Markdown';
import { since } from '../issues/since';

interface StagedCommentsProps {
  projectPath: string;
  drafts: LinearCommentDraft[];
}

/**
 * Comments an agent wrote, held until a person sends them.
 *
 * A person pressing send in the composer is itself the human gate, which is why
 * that box posts directly. Nothing in a task terminal has one, so what it wrote
 * waits here, in the thread it would join, with its origin beside it.
 */
export function StagedComments({ projectPath, drafts }: StagedCommentsProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (drafts.length === 0) return null;

  const send = async (draft: LinearCommentDraft) => {
    setBusyId(draft.id);
    try {
      const result = await window.api.linear.sendDraft(projectPath, draft.id);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not send the comment', 'error');
        return;
      }
      await useLinearStore.getState().reloadIssue(projectPath);
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (draft: LinearCommentDraft) => {
    await window.api.linear.discardDraft(projectPath, draft.id);
    await useLinearStore.getState().loadDrafts(projectPath, draft.issueId);
  };

  return (
    <div className="flex flex-col gap-5">
      {drafts.map((draft) => (
        <article key={draft.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
            <span className="text-accent">Unsent</span>
            <span className="opacity-50">·</span>
            <span>{draft.origin}</span>
            <span className="opacity-50">·</span>
            <span className="flex-1 min-w-0 truncate">{since(draft.createdAt)}</span>
            <button
              type="button"
              className="btn-primary btn-compact"
              disabled={busyId === draft.id}
              onClick={() => void send(draft)}
            >
              {busyId === draft.id ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              className="text-text-tertiary hover:text-text-primary transition-colors duration-100"
              onClick={() => void discard(draft)}
            >
              Discard
            </button>
          </div>
          <Markdown body={draft.body} />
        </article>
      ))}
    </div>
  );
}
