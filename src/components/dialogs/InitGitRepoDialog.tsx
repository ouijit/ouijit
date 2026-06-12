import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';
import { useAppStore } from '../../stores/appStore';
import { folderName } from '../../utils/folderName';

interface InitGitRepoDialogProps {
  folderPath: string;
  onClose: (result: { initialized: boolean; initialCommit: boolean } | null) => void;
}

/**
 * Offered when a user picks a plain (non-git) folder to add as a project.
 * Turns the "not a git repository" dead-end into a guided `git init` in place,
 * with an optional initial commit of any existing files.
 */
export function InitGitRepoDialog({ folderPath, onClose }: InitGitRepoDialogProps) {
  const [visible, setVisible] = useState(false);
  const [initialCommit, setInitialCommit] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = useAppStore((s) => s.health);
  const gitMissing = health !== null && !health.git;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(
    (result: { initialized: boolean; initialCommit: boolean } | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleInit = useCallback(async () => {
    if (working || gitMissing) return;
    setError(null);
    setWorking(true);
    const result = await window.api.initGitRepo(folderPath, initialCommit);
    if (result.success) {
      dismiss({ initialized: true, initialCommit });
    } else {
      setError(result.error ?? 'Could not initialize git repository.');
      setWorking(false);
    }
  }, [working, gitMissing, folderPath, initialCommit, dismiss]);

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)} maxWidth={440}>
      <h2 data-testid="dialog-title" className="text-lg font-semibold text-text-primary mb-4 text-center">
        Not a Git Repository
      </h2>
      <p className="text-sm text-text-secondary text-center">
        &ldquo;<strong className="text-text-primary">{folderName(folderPath)}</strong>&rdquo; isn&rsquo;t a Git
        repository yet. Initialize one here to add it as a project?
      </p>
      <p className="text-xs text-text-secondary/70 text-center mt-1 font-mono break-all">{folderPath}</p>
      {gitMissing ? (
        <div
          className="mt-4 px-3 py-2 rounded-md text-xs text-text-primary"
          style={{ background: 'var(--color-git-light)', border: '1px solid var(--color-git)' }}
        >
          <strong className="font-medium">Git not found.</strong> Install via{' '}
          <code className="px-1 py-0.5 rounded bg-white/10 font-mono">xcode-select --install</code> (macOS) or your
          package manager.
        </div>
      ) : (
        <label className="flex items-center gap-2 justify-center mt-4 text-sm text-text-secondary [-webkit-app-region:no-drag]">
          <input
            type="checkbox"
            checked={initialCommit}
            onChange={(e) => setInitialCommit(e.target.checked)}
            disabled={working}
          />
          Create an initial commit of existing files
        </label>
      )}
      {error && (
        <p data-testid="dialog-error" className="text-xs text-error mt-3 text-center">
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button data-testid="dialog-cancel" className="btn-secondary" onClick={() => dismiss(null)} disabled={working}>
          Cancel
        </button>
        <button data-testid="dialog-init" className="btn-primary" onClick={handleInit} disabled={working || gitMissing}>
          {working ? 'Initializing…' : 'Initialize Repository'}
        </button>
      </div>
    </DialogOverlay>
  );
}
