import { useCallback, useEffect, useState } from 'react';
import type { LinearAvailability, LinearScope } from '../../linear/types';
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
          {/* First, and in mono: a row about a key should look like it holds
              one before it says whose it is. */}
          {availability?.masked && (
            <div className="text-[13px] font-mono text-text-secondary mt-1 truncate">{availability.masked}</div>
          )}
          <div className="text-xs text-text-tertiary mt-1">{describe(availability)}</div>
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
              {own ? 'Replace key' : 'Use a project key'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          <p className="text-xs text-text-tertiary">
            Used by this project only. Every other project keeps the shared key.
          </p>
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
        </>
      )}
    </div>
  );
}

/**
 * The description slot: who the key is, and where it applies. Two short
 * phrases rather than a sentence — the second is the one that answers whether
 * changing it here changes it everywhere.
 */
function describe(availability: LinearAvailability | null): string {
  if (!availability) return 'Checking…';
  if (availability.reason === 'flag-off') return 'Turn on Linear under Experimental.';
  if (!availability.connected) return availability.message ?? 'Create one in Linear under Settings → API.';

  const viewer = availability.viewer;
  const who = viewer ? `${viewer.name} in ${viewer.workspaceName} · ` : '';
  if (availability.source === 'project') return `${who}This project only`;
  if (availability.storage === 'environment') return `${who}From LINEAR_API_KEY`;
  return `${who}Shared with every project`;
}
