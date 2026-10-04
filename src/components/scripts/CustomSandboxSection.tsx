import { useState, useEffect, useCallback } from 'react';
import type { CustomSandboxConfig } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { HookRowView } from './HookRowView';
import { CARD, PILL_BTN } from './sandboxStyles';

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
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-tertiary">
        Runs a task's terminals under a launcher from this project's host settings. The launcher owns the boundary;
        Ouijit grants nothing itself.
      </p>

      <div className={CARD}>
        <HookRowView
          label="Sandbox command"
          description="Absolute path or a name on PATH, outside the repo. Receives the shell after --."
          command={config.command}
          onAction={editing ? undefined : openEditor}
        />
        {editing && (
          <div className="flex flex-col gap-2 px-4 py-3">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              spellCheck={false}
              aria-label="Sandbox command"
              placeholder="~/.local/bin/ouijit-sandbox"
              className="h-16 w-full resize-y rounded-[10px] border border-bezel bg-background-secondary px-3 py-2 font-mono text-xs leading-relaxed text-text-primary outline-none"
            />
            {error && <div className="text-xs text-error">{error}</div>}
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => void save({ command: draft })} className={PILL_BTN}>
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className={PILL_BTN}>
                Cancel
              </button>
              {config.command && (
                <button
                  type="button"
                  onClick={() => void save({})}
                  className="ml-auto text-xs text-text-tertiary hover:text-text-primary"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
