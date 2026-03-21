import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { TaskWithWorkspace } from '../../types';

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismiss(null);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [dismiss]);

  return createPortal(
    <div
      className={`modal-overlay ${visible ? 'modal-overlay--visible' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss(null);
      }}
    >
      <div className={`dialog ${visible ? 'dialog--visible' : ''}`} style={{ maxWidth: 420 }}>
        <h2 className="dialog-title">Worktree Not Found</h2>
        <p className="dialog-text">
          The worktree directory for &ldquo;<strong>{task.name}</strong>&rdquo; no longer exists on disk.
        </p>
        {task.branch && (
          <p className="dialog-text" style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
            Branch: <code>{task.branch}</code>
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={() => dismiss(null)}>
            Cancel
          </button>
          {branchExists && (
            <button className="btn btn-primary" onClick={() => dismiss('recover')}>
              Recreate Worktree
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
