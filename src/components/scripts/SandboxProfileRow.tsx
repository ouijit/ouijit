import { useEffect, useState } from 'react';
import type { NonoProfile } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectConfig } from '../../stores/projectDataStore';
import { ROW_ACTION } from './sandboxStyles';

function tildePath(file: string, home: string | null): string {
  return home && file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

export function SandboxProfileRow({ projectPath }: { projectPath: string }) {
  const [profile, setProfile] = useState<NonoProfile | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const status = useProjectConfig(projectPath)?.sandboxStatuses.find((st) => st.providerId === 'nono');

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
  }, [projectPath]);

  const open = async () => {
    const result = await window.api.sandbox.openNonoProfile(projectPath);
    if (!result.success) useProjectStore.getState().addToast(result.error ?? 'Could not open the profile', 'error');
  };
  const choose = async () => {
    const next = await window.api.sandbox.chooseNonoProfile(projectPath);
    if (next) setProfile(next);
  };
  const reset = async () => setProfile(await window.api.sandbox.resetNonoProfile(projectPath));

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
