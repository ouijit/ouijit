import { useEffect, useState } from 'react';
import type { LinearConnection } from '../linear/types';
import { Icon } from './terminal/Icon';

/**
 * Where the Linear API key is pasted, and who it turns out to belong to.
 *
 * One key for the app rather than one per project: a personal key belongs to
 * one workspace. The key goes straight to the main process and never comes
 * back — the row shows the name and workspace it resolved to.
 */
export function LinearSettingsSection() {
  const [connection, setConnection] = useState<LinearConnection | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.api.linear.connection().then(setConnection);
  }, []);

  const save = async (value: string) => {
    setBusy(true);
    try {
      const result = await window.api.linear.setCredential(value);
      if (!result.success) {
        setConnection({ connected: false, message: result.error, canStore: false });
        return;
      }
      setKey('');
      setConnection(await window.api.linear.connection(undefined, true));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-4">Linear</h2>
      <div className="glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg">
        <div className="px-4 py-3 flex flex-col gap-2">
          <div className="text-sm text-text-primary">API key</div>
          <p className="text-xs text-text-tertiary">Shared with every project, and encrypted by your OS keychain.</p>
          {/* Only while there is a key to create: what the scopes buy is
              something you act on in Linear, and nowhere else. */}
          {!connection?.connected && (
            <p className="text-xs text-text-tertiary">
              Create one under Settings → API in Linear. Read and Create comments to read and comment; add Write to
              change an issue's status.
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && key.trim()) void save(key);
              }}
              placeholder={connection?.connected ? 'Enter a new key' : 'lin_api_…'}
              className="field flex-1 min-w-0"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn-primary btn-compact"
              disabled={busy || !key.trim()}
              onClick={() => void save(key)}
            >
              {busy ? 'Checking…' : 'Save'}
            </button>
            {connection?.connected && (
              <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => void save('')}>
                Clear
              </button>
            )}
          </div>
          <Standing connection={connection} />
        </div>
      </div>
    </section>
  );
}

function Standing({ connection }: { connection: LinearConnection | null }) {
  if (!connection) return null;

  if (connection.connected && connection.viewer) {
    return (
      <p className="text-xs text-text-secondary flex items-center gap-1.5">
        <Icon name="check-circle" className="w-3.5 h-3.5 text-vcs-added" />
        {connection.viewer.name} in {connection.viewer.workspaceName}
        {connection.storage === 'environment' && <span className="text-text-tertiary">· read from LINEAR_API_KEY</span>}
      </p>
    );
  }

  if (connection.canStore === false) {
    return (
      <p className="text-xs text-text-secondary">
        {connection.message ??
          'No keychain available to encrypt the key. Set LINEAR_API_KEY in your environment instead.'}
      </p>
    );
  }

  return <p className="text-xs text-text-tertiary">{connection.message ?? 'No key added.'}</p>;
}
