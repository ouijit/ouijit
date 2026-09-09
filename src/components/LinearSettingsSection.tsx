import { useEffect, useState } from 'react';
import type { LinearConnection } from '../linear/types';
import { LinearKeyRow } from './linear/LinearKeyRow';

/**
 * The API key every project reads Linear with, unless it keeps its own.
 *
 * The key goes straight to the main process and never comes back — what the row
 * shows is who it resolved to, and enough of the key to recognise it by.
 */
export function LinearSettingsSection() {
  const [connection, setConnection] = useState<LinearConnection | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.api.linear.connection().then(setConnection);
  }, []);

  const save = async (apiKey: string) => {
    setBusy(true);
    try {
      const result = await window.api.linear.setCredential(apiKey);
      if (!result.success) {
        setConnection({ connected: false, message: result.error, canStore: false });
        return false;
      }
      setConnection(await window.api.linear.connection(undefined, true));
      return true;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-2">Linear</h2>
      <p className="text-xs text-text-tertiary mb-4">Shared with every project, and encrypted by your OS keychain.</p>
      <div className="glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg">
        <LinearKeyRow
          connection={connection}
          busy={busy}
          onSave={save}
          {...(connection?.connected ? { secondary: { label: 'Clear', onClick: () => void save('') } } : {})}
          help="Create one in Linear under Settings → API. Read and Create comments to read and comment; add Write to change an issue's status."
        />
      </div>
    </section>
  );
}
