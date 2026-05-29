import { useState, useEffect, useCallback } from 'react';
import type { TaskWithWorkspace } from '../../types';
import { DialogOverlay } from './DialogOverlay';

interface MissingWorktreeDialogProps {
  task: TaskWithWorkspace;
  branchExists: boolean;
  onClose: (action: 'recover' | null) => void;
}

export function MissingWorktreeDialog({ task, branchExists, onClose }: MissingWorktreeDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(
    (action: 'recover' | null) => {
      setVisible(false);
      setTimeout(() => onClose(action), 200);
    },
    [onClose],
  );

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)} maxWidth={420}>
      <h2 data-testid="dialog-title" className="text-lg font-semibold text-text-primary mb-4 text-center">
        Worktree Not Found
      </h2>
      <p className="text-sm text-text-secondary text-center">
        {task.worktreePath ? (
          <>
            The worktree directory for &ldquo;<strong className="text-text-primary">{task.name}</strong>&rdquo; no
            longer exists on disk.
          </>
        ) : (
          <>
            No worktree has been created for &ldquo;<strong className="text-text-primary">{task.name}</strong>&rdquo;.
          </>
        )}
      </p>
      {task.branch && (
        <p className="text-xs text-text-secondary/70 text-center mt-1">
          Branch: <code className="font-mono">{task.branch}</code>
        </p>
      )}
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button data-testid="dialog-cancel" className="btn-secondary" onClick={() => dismiss(null)}>
          Cancel
        </button>
        <button data-testid="dialog-recover" className="btn-primary" onClick={() => dismiss('recover')}>
          {branchExists ? 'Recreate Worktree' : 'Create Worktree'}
        </button>
      </div>
    </DialogOverlay>
  );
}
