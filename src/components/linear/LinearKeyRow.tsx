import { useState, type ReactNode } from 'react';
import type { LinearConnection } from '../../linear/types';
import { useProjectStore } from '../../stores/projectStore';

interface LinearKeyRowProps {
  /** Null while it is still being checked. */
  connection: LinearConnection | null;
  /** The project taking a key of its own. Absent for the key every project shares. */
  projectPath?: string;
  /** Re-read whatever the caller is showing, once the key has changed. */
  onSaved: () => Promise<void>;
  /**
   * What opening the field is called. "Replace API key" replaces the one shown;
   * a project reading the shared key is not replacing it, it is taking one of
   * its own, and the button has to say which.
   */
  replaceLabel?: string;
  /** Words for the button that clears the key — Clear here, Use the shared API key there. */
  clear?: { label: string; title?: string };
  /** Shown while the field is open, saying what saving will do. */
  hint?: ReactNode;
  /** Shown when there is no key: where to get one. */
  help?: ReactNode;
  /** Say where the key applies. Off where the section above already says it. */
  showScope?: boolean;
}

/**
 * The API key row, in both places a key can be set.
 *
 * One component because there is one row: App Settings holds the shared key and
 * a project can hold its own, but a key is a key, and two copies of this drifted
 * apart the first time one of them was touched.
 *
 * The field is not a permanent empty form. It opens when there is no key to
 * show, or when you ask to replace the one there is — a Save button over an
 * empty box, beside a key that is already working, is an action with no object.
 */
export function LinearKeyRow({
  connection,
  projectPath,
  onSaved,
  replaceLabel = 'Replace API key',
  clear,
  hint,
  help,
  showScope,
}: LinearKeyRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const connected = connection?.connected ?? false;
  const open = editing || (connection != null && !connected);

  const save = async (apiKey: string) => {
    setBusy(true);
    try {
      const result = await window.api.linear.setCredential(apiKey, projectPath);
      if (!result.success) {
        useProjectStore.getState().addToast(result.error ?? "Couldn't save the key", 'error');
        return;
      }
      setValue('');
      setEditing(false);
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary">API key</div>
          {/* First, and in mono: a row about a key should look like it holds
              one before it says whose it is. */}
          {connection?.masked && (
            <div className="text-[13px] font-mono text-text-secondary mt-1 truncate">{connection.masked}</div>
          )}
          <div className="text-xs text-text-tertiary mt-1">{describe(connection, showScope)}</div>
          {!connected && help && <div className="text-xs text-text-tertiary mt-1">{help}</div>}
        </div>

        {(connected || clear) && (
          <div className="flex items-center gap-2 shrink-0">
            {connected && !open && (
              <button type="button" className="btn-secondary btn-compact h-8" onClick={() => setEditing(true)}>
                {replaceLabel}
              </button>
            )}
            {clear && (
              <button
                type="button"
                className="btn-secondary btn-compact h-8"
                disabled={busy}
                title={clear.title}
                onClick={() => void save('')}
              >
                {clear.label}
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <>
          {hint && <p className="text-xs text-text-tertiary">{hint}</p>}
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

/** Who the key is, and — where the caller asks for it — where it applies. */
function describe(connection: LinearConnection | null, showScope?: boolean): string {
  if (!connection) return 'Checking…';
  if (connection.reason === 'flag-off') return 'Turn on Linear under Experimental.';
  if (!connection.connected) return connection.message ?? 'Create one in Linear under Settings → API.';

  const viewer = connection.viewer;
  const who = viewer ? `${viewer.name} in ${viewer.workspaceName}` : '';
  if (connection.storage === 'environment') return `${who} · From LINEAR_API_KEY`;
  if (!showScope) return who;
  return connection.source === 'project' ? `${who} · This project only` : `${who} · Shared with every project`;
}
