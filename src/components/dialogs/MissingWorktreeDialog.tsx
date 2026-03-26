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
        The worktree directory for &ldquo;<strong className="text-text-primary">{task.name}</strong>&rdquo; no longer
        exists on disk.
      </p>
      {task.branch && (
        <p className="text-xs text-text-secondary/70 text-center mt-1">
          Branch: <code className="font-mono">{task.branch}</code>
        </p>
      )}
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button
          data-testid="dialog-cancel"
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-accent bg-accent-light hover:bg-[rgba(0,122,255,0.15)]"
          onClick={() => dismiss(null)}
        >
          Cancel
        </button>
        {branchExists && (
          <button
            data-testid="dialog-recover"
            className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98]"
            onClick={() => dismiss('recover')}
          >
            Recreate Worktree
          </button>
        )}
      </div>
    </DialogOverlay>
  );
}
