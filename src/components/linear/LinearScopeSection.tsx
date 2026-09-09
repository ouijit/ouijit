import { useEffect, useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
import { useLinearStore } from '../../stores/linearStore';
import { useProjectStore } from '../../stores/projectStore';
import { ScopePicker } from './ScopePicker';

interface LinearScopeSectionProps {
  projectPath: string;
}

/**
 * Where this project's Linear issues come from, once the panel has stopped
 * asking. The panel's connect row disappears the moment it is answered, so
 * changing that answer — or taking it back — lives here.
 */
export function LinearScopeSection({ projectPath }: LinearScopeSectionProps) {
  const [availability, setAvailability] = useState<LinearAvailability | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.api.linear.availability(projectPath).then((next) => {
      if (!cancelled) setAvailability(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  // The panel holds the same answer, and reads it on open rather than on a
  // push, so it is told here instead of finding out later.
  const apply = async (scope: LinearScope | null) => {
    setBusy(true);
    try {
      const result = await window.api.linear.setScope(projectPath, scope);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? 'Could not change the Linear scope', 'error');
        return;
      }
      setAvailability(await window.api.linear.availability(projectPath, true));
      const store = useLinearStore.getState();
      if (store.projectPath === projectPath) {
        await store.loadAvailability(projectPath, true);
        await store.loadIssues(projectPath);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary">Issues from</div>
          <div className="text-xs text-text-tertiary mt-0.5">{standing(availability)}</div>
        </div>
        {availability?.connected && availability.scope && (
          <div className="flex items-center gap-2 shrink-0">
            <ScopePicker
              availability={availability}
              value={availability.scope}
              onChange={(scope) => void apply(scope)}
              disabled={busy}
              className="w-[13rem]"
            />
            <button
              type="button"
              className="btn-secondary btn-compact h-8"
              disabled={busy}
              onClick={() => void apply(null)}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function standing(availability: LinearAvailability | null): string {
  if (!availability) return 'Checking…';
  if (availability.reason === 'flag-off') return 'Turn Linear on under Experimental to connect this project.';
  if (!availability.connected) {
    return availability.message ?? 'Add a Linear API key under App Settings to connect this project.';
  }
  if (!availability.scope) return 'Not connected yet — the Issues list asks, above the list.';
  return availability.scope.kind === 'repo-label'
    ? 'A label on the issues, so it can span teams.'
    : 'Every issue on this team.';
}
