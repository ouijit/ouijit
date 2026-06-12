import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';
import { folderName } from '../../utils/folderName';

interface AddSiblingProjectsDialogProps {
  parentDir: string;
  /** Absolute paths of sibling git repos not yet registered */
  siblings: string[];
  onClose: (result: { addAll: boolean } | null) => void;
}

/**
 * Offered after adding an existing project whose parent directory contains
 * other git repos that aren't registered yet — one click registers the whole
 * folder of projects instead of adding them one at a time.
 */
export function AddSiblingProjectsDialog({ parentDir, siblings, onClose }: AddSiblingProjectsDialogProps) {
  const [visible, setVisible] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(
    (result: { addAll: boolean } | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleAddAll = useCallback(() => {
    if (working) return;
    setWorking(true);
    dismiss({ addAll: true });
  }, [working, dismiss]);

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)} maxWidth={440}>
      <h2 data-testid="dialog-title" className="text-lg font-semibold text-text-primary mb-4 text-center">
        Add Nearby Projects?
      </h2>
      <p className="text-sm text-text-secondary text-center">
        &ldquo;<strong className="text-text-primary">{folderName(parentDir)}</strong>&rdquo; contains{' '}
        {siblings.length === 1 ? 'another git repository' : `${siblings.length} other git repositories`}. Add{' '}
        {siblings.length === 1 ? 'it' : 'them'} as {siblings.length === 1 ? 'a project' : 'projects'} too?
      </p>
      <p className="text-xs text-text-secondary/70 text-center mt-1 font-mono break-all">{parentDir}</p>
      <ul className="mt-4 max-h-40 overflow-y-auto rounded-md border border-border bg-background divide-y divide-white/[0.06]">
        {siblings.map((sibling) => (
          <li key={sibling} className="px-3 py-1.5 text-xs font-mono text-text-secondary truncate" title={sibling}>
            {folderName(sibling)}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button data-testid="dialog-cancel" className="btn-secondary" onClick={() => dismiss(null)} disabled={working}>
          Just This One
        </button>
        <button data-testid="dialog-add-all" className="btn-primary" onClick={handleAddAll} disabled={working}>
          {siblings.length === 1 ? 'Add It' : `Add All ${siblings.length}`}
        </button>
      </div>
    </DialogOverlay>
  );
}
