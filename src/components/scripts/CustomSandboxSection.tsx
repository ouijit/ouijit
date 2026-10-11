import { useState, useEffect, useCallback } from 'react';
import type { CustomSandboxConfig } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { CARD, FIELD, PRIMARY_BUTTON, ROW_ACTION } from './sandboxStyles';
import { QUIET_BUTTON } from './LensList';

interface CustomSandboxSectionProps {
  projectPath: string;
}

const SAVE_FAILED = 'Could not save the sandbox command';

export function CustomSandboxSection({ projectPath }: CustomSandboxSectionProps) {
  const [config, setConfig] = useState<CustomSandboxConfig>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.api.sandbox.customConfig(projectPath).then((cfg) => {
      if (active) setConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, [projectPath]);

  const save = useCallback(
    async (next: CustomSandboxConfig) => {
      const result = await window.api.sandbox.setCustomConfig(projectPath, next).catch(() => ({ success: false }));
      if (!result.success) {
        setError(('error' in result && result.error) || SAVE_FAILED);
        return;
      }
      setConfig(next.command ? { command: next.command.trim() } : {});
      setEditing(false);
      setError(null);
      await useProjectStore.getState().loadProjectConfig(projectPath);
    },
    [projectPath],
  );

  const openEditor = () => {
    setDraft(config.command ?? '');
    setError(null);
    setEditing(true);
  };

  return (
    <section aria-label="Custom" className={CARD}>
      <div className="px-4 py-3">
        <div className="text-sm font-medium text-text-primary">Custom</div>
        <div className="mt-0.5 text-xs text-text-tertiary">
          A launcher you provide, run as <code className="font-mono">&lt;command&gt; -- &lt;shell&gt;</code>.
        </div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-text-primary">Launcher</div>
            <div className="mt-0.5 truncate text-xs text-text-tertiary">
              {config.command ? <span className="font-mono text-text-secondary">{config.command}</span> : 'Not set'}
            </div>
          </div>
          {!editing && (
            <button type="button" onClick={openEditor} className={ROW_ACTION}>
              {config.command ? 'Edit' : '+ Configure'}
            </button>
          )}
        </div>
        {editing && (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              spellCheck={false}
              aria-label="Launcher command"
              placeholder="~/.local/bin/ouijit-sandbox"
              className={`${FIELD} h-16 w-full resize-y font-mono leading-relaxed`}
            />
            {error && <div className="text-xs text-error">{error}</div>}
            <div className="flex items-center justify-end gap-1.5">
              {config.command && (
                <button type="button" onClick={() => void save({})} className={`${ROW_ACTION} mr-auto`}>
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setEditing(false)} className={QUIET_BUTTON}>
                Cancel
              </button>
              <button type="button" onClick={() => void save({ command: draft })} className={PRIMARY_BUTTON}>
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
