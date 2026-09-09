import { useCallback, useEffect, useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';
import { useProjectStore } from '../../stores/projectStore';
import { LinearKeyRow } from './LinearKeyRow';
import { ScopePicker } from './ScopePicker';

interface LinearScopeSectionProps {
  projectPath: string;
}

/**
 * What this project reads Linear with, and which of the workspace's issues it
 * reads. The panel's connect row disappears the moment it is answered, so
 * changing that answer — or taking it back — lives here.
 */
export function LinearScopeSection({ projectPath }: LinearScopeSectionProps) {
  const [availability, setAvailability] = useState<LinearAvailability | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (recheck = false) => {
      setAvailability(await window.api.linear.availability(projectPath, recheck));
    },
    [projectPath],
  );

  useEffect(() => {
    let cancelled = false;
    void window.api.linear.availability(projectPath).then((next) => {
      if (!cancelled) setAvailability(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  // The panel holds the same answers, and reads them on open rather than on a
  // push, so it is told here instead of finding out later.
  const refreshPanel = async () => {
    const store = useLinearStore.getState();
    if (store.projectPath !== projectPath) return;
    await store.loadAvailability(projectPath, true);
    await store.loadIssues(projectPath);
  };

  const setKey = async (apiKey: string) => {
    setBusy(true);
    try {
      const result = await window.api.linear.setCredential(apiKey, projectPath);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? "Couldn't save the key", 'error');
        return false;
      }
      await reload(true);
      await refreshPanel();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const setScope = async (scope: LinearScope | null) => {
    setBusy(true);
    try {
      const result = await window.api.linear.setScope(projectPath, scope);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? "Couldn't change which issues show", 'error');
        return;
      }
      await reload(true);
      await refreshPanel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg">
      <LinearKeyRow
        connection={availability}
        busy={busy}
        onSave={setKey}
        showScope
        replaceLabel={
          availability?.source === 'project' ? 'Replace API key' : 'Use a different API key for this project'
        }
        {...(availability?.source === 'project'
          ? {
              secondary: {
                label: 'Use the shared API key',
                title: 'Go back to the API key every other project uses',
                onClick: () => void setKey(''),
              },
            }
          : {})}
        hint="This API key will be used by this project only. Every other project keeps the shared one."
        help="Create one in Linear under Settings → API."
      />

      {availability?.connected && availability.scope && (
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Issues</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ScopePicker
              availability={availability}
              value={availability.scope}
              onChange={(scope) => void setScope(scope)}
              disabled={busy}
              className="w-[13rem]"
            />
            <button
              type="button"
              className="btn-secondary btn-compact h-8"
              disabled={busy}
              onClick={() => void setScope(null)}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
