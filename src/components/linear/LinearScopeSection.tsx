import { useCallback, useEffect, useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
import { useAppStore } from '../../stores/appStore';
import { useLinearStore } from '../../stores/linearStore';
import { useProjectStore } from '../../stores/projectStore';
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
      <KeyRow availability={availability} busy={busy} onSave={setKey} />

      {availability?.connected && availability.scope && (
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Show issues from</div>
            <div className="text-xs text-text-tertiary mt-0.5">
              {availability.scope.kind === 'repo-label'
                ? `Issues labeled ${availability.scope.name}, across every team.`
                : `Every issue in ${availability.scope.name}.`}
            </div>
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

/**
 * The key this project reads with.
 *
 * A key resolves to exactly one Linear workspace, so a project in a second one
 * needs a key of its own. Most do not: the app-wide key is the default, shown
 * here rather than only in App Settings because this is where you find out you
 * need one.
 */
function KeyRow({
  availability,
  busy,
  onSave,
}: {
  availability: LinearAvailability | null;
  busy: boolean;
  onSave: (apiKey: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const connected = availability?.connected ?? false;
  const own = availability?.source === 'project';
  // The wall is a project with no usable key: the field is offered there rather
  // than a sentence pointing at another panel.
  const open = editing || (availability != null && !connected);

  const save = async (apiKey: string) => {
    if (await onSave(apiKey)) {
      setValue('');
      setEditing(false);
    }
  };

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary">API key</div>
          <div className="text-xs text-text-tertiary mt-0.5">{standing(availability)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {own && (
            <button
              type="button"
              className="btn-secondary btn-compact h-8"
              disabled={busy}
              title="Read Linear with the key every other project uses"
              onClick={() => void save('')}
            >
              Use shared key
            </button>
          )}
          {connected && !open && (
            <button type="button" className="btn-secondary btn-compact h-8" onClick={() => setEditing(true)}>
              {own ? 'Replace key' : 'Use a different key'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) void save(value);
              if (e.key === 'Escape' && connected) setEditing(false);
            }}
            placeholder="lin_api_…"
            spellCheck={false}
            className="field flex-1 min-w-0"
          />
          <button
            type="button"
            className="btn-primary btn-compact h-8 shrink-0"
            disabled={busy || !value.trim()}
            onClick={() => void save(value)}
          >
            {busy ? 'Checking…' : 'Save'}
          </button>
          {connected && (
            <button
              type="button"
              className="btn-secondary btn-compact h-8 shrink-0"
              onClick={() => {
                setValue('');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Who the key is, then where it came from. One shape, one clause different. */
function standing(availability: LinearAvailability | null): string {
  if (!availability) return 'Checking…';
  if (availability.reason === 'flag-off') return 'Turn on Linear under Experimental to use it here.';
  if (!availability.connected) {
    return availability.message ?? 'Create a key in Linear under Settings → API.';
  }

  const viewer = availability.viewer;
  const who = viewer ? `${viewer.name} in ${viewer.workspaceName}. ` : '';
  if (availability.source === 'project') return `${who}Used by this project only.`;
  if (availability.storage === 'environment') return `${who}Read from LINEAR_API_KEY.`;
  return `${who}Shared with every project.`;
}

/** Kept beside the row it explains, since the key itself lives a panel up. */
export function AppSettingsLink() {
  return (
    <button
      type="button"
      onClick={() => useAppStore.getState().navigateHome({ panel: 'settings', direction: 'up' })}
      className="text-accent underline-offset-2 hover:underline outline-none focus-visible:underline"
    >
      App Settings
    </button>
  );
}
