import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';

export type MoveProjectsAction = 'move' | 'forget' | 'keep';

interface MoveProjectsDialogProps {
  newFolder: string;
  /** Projects currently living in the old projects folder */
  projects: { path: string; name: string }[];
  onClose: (result: { action: MoveProjectsAction } | null) => void;
}

interface ActionOption {
  action: MoveProjectsAction;
  label: string;
  description: string;
}

/**
 * Shown when the projects folder setting changes while projects still live in
 * the old folder. The user decides what happens to them: move the folders to
 * the new location, forget them (keep files, drop from the project list), or
 * leave them where they are.
 */
export function MoveProjectsDialog({ newFolder, projects, onClose }: MoveProjectsDialogProps) {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<MoveProjectsAction>('move');
  const [working, setWorking] = useState(false);

  const options: ActionOption[] = [
    {
      action: 'move',
      label: 'Move them to the new folder',
      description: `Each project folder moves into ${newFolder}. Tasks, hooks, and settings stay attached.`,
    },
    {
      action: 'forget',
      label: 'Forget them',
      description: 'Projects are removed from Ouijit. The folders and files stay on disk.',
    },
    {
      action: 'keep',
      label: 'Leave them where they are',
      description: 'Nothing moves. Only new projects are created in the new folder.',
    },
  ];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(
    (result: { action: MoveProjectsAction } | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleApply = useCallback(() => {
    if (working) return;
    setWorking(true);
    dismiss({ action: selected });
  }, [working, selected, dismiss]);

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)} maxWidth={460}>
      <h2 data-testid="dialog-title" className="text-lg font-semibold text-text-primary mb-4 text-center">
        Existing Projects
      </h2>
      <p className="text-sm text-text-secondary text-center">
        {projects.length === 1 ? '1 project lives' : `${projects.length} projects live`} in your current projects
        folder. What should happen to {projects.length === 1 ? 'it' : 'them'}?
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {options.map((option) => (
          <label
            key={option.action}
            className={`flex items-start gap-3 px-3 py-2.5 rounded-md border [-webkit-app-region:no-drag] ${
              selected === option.action ? 'border-accent bg-accent-light/20' : 'border-border hover:bg-white/[0.02]'
            }`}
          >
            <input
              type="radio"
              name="move-projects-action"
              className="mt-0.5"
              checked={selected === option.action}
              onChange={() => setSelected(option.action)}
              disabled={working}
            />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-text-primary">{option.label}</span>
              <span className="block text-xs text-text-tertiary mt-0.5 break-words">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button data-testid="dialog-cancel" className="btn-secondary" onClick={() => dismiss(null)} disabled={working}>
          Cancel
        </button>
        <button data-testid="dialog-apply" className="btn-primary" onClick={handleApply} disabled={working}>
          {selected === 'move' ? 'Move Projects' : selected === 'forget' ? 'Forget Projects' : 'Change Folder'}
        </button>
      </div>
    </DialogOverlay>
  );
}
