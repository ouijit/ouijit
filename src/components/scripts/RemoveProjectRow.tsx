import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { CARD, ROW_ACTION } from './sandboxStyles';

export function RemoveProjectRow({ projectPath }: { projectPath: string }) {
  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    const result = await window.api.removeProject(projectPath);
    if (!result.success) {
      useProjectStore.getState().addToast('Could not remove the project', 'error');
      return;
    }
    useAppStore.getState().select({ kind: 'none' });
    useAppStore.getState().setProjects(await window.api.refreshProjects());
  };

  return (
    <div className={CARD}>
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-primary">Remove project</div>
          <div className="mt-0.5 text-xs text-text-tertiary">
            Takes it out of Ouijit with its tasks, hooks and scripts. The folder stays on disk.
          </div>
        </div>
        {confirming ? (
          <>
            <button type="button" onClick={() => setConfirming(false)} className={ROW_ACTION}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              className="shrink-0 px-2 py-1 text-[11px] bg-transparent border-none text-error hover:opacity-80 transition-opacity duration-150"
            >
              Remove
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={ROW_ACTION}>
            Remove…
          </button>
        )}
      </div>
    </div>
  );
}
