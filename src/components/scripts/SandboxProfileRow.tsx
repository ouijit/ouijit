import { useEffect, useState } from 'react';
import type { NonoProfile } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectConfig } from '../../stores/projectDataStore';
import { ROW_ACTION } from './sandboxStyles';

function tildePath(file: string, home: string | null): string {
  return home && file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

/** `onChange` runs after another profile is chosen, or the project's own restored. */
export function SandboxProfileRow({ projectPath, onChange }: { projectPath: string; onChange?: () => void }) {
  const [profile, setProfile] = useState<NonoProfile | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const statuses = useProjectConfig(projectPath)?.sandboxStatuses;
  const status = statuses?.find((st) => st.providerId === 'nono');

  useEffect(() => {
    let active = true;
    void Promise.all([window.api.sandbox.nonoProfile(projectPath), window.api.homePath()]).then(([next, dir]) => {
      if (!active) return;
      setProfile(next);
      setHome(dir);
    });
    return () => {
      active = false;
    };
    // A reload of the project's config, which a change from the CLI sets off, renews `statuses`.
  }, [projectPath, statuses]);

  const open = async () => {
    const result = await window.api.sandbox.openNonoProfile(projectPath);
    if (!result.success) useProjectStore.getState().addToast(result.error ?? 'Could not open the profile', 'error');
  };
  const choose = async () => {
    const next = await window.api.sandbox.chooseNonoProfile(projectPath);
    if (!next) return;
    setProfile(next);
    onChange?.();
  };
  const reset = async () => {
    setProfile(await window.api.sandbox.resetNonoProfile(projectPath));
    onChange?.();
  };

  const unavailable = status && !status.available ? status.detail : undefined;

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary">Sandbox profile</div>
        <div className="mt-0.5 truncate text-xs text-text-tertiary">
          {unavailable ?? (profile && <code className="font-mono">{tildePath(profile.path, home)}</code>)}
        </div>
      </div>
      {profile && (
        <>
          <button type="button" onClick={() => void open()} className={ROW_ACTION}>
            Open
          </button>
          <button type="button" onClick={() => void choose()} className={ROW_ACTION}>
            Change…
          </button>
          {!profile.own && (
            <button type="button" onClick={() => void reset()} className={ROW_ACTION}>
              Reset
            </button>
          )}
        </>
      )}
    </div>
  );
}
