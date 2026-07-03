import { useState, useEffect, useCallback } from 'react';
import type { NonoConfig } from '../../types';

interface NonoSandboxSectionProps {
  projectPath: string;
}

/**
 * Config surface for the nono backend: an optional named profile and a network
 * restriction toggle. Copy stays to mechanism (what the flag does), not
 * isolation guarantees.
 */
export function NonoSandboxSection({ projectPath }: NonoSandboxSectionProps) {
  const [config, setConfig] = useState<NonoConfig>({});
  const [profiles, setProfiles] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([window.api.sandbox.nonoConfig(projectPath), window.api.sandbox.nonoProfiles()]).then(
      ([cfg, profs]) => {
        if (!active) return;
        setConfig(cfg);
        setProfiles(profs);
      },
    );
    return () => {
      active = false;
    };
  }, [projectPath]);

  const save = useCallback(
    (next: NonoConfig) => {
      setConfig(next);
      void window.api.sandbox.setNonoConfig(projectPath, next);
    },
    [projectPath],
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-tertiary">
        Runs task commands under nono on this machine. Filesystem access is scoped to the task worktree and its git
        data; the agent status channel stays reachable.
      </p>

      <div className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden bg-[var(--color-terminal-bg,#171717)]">
        <label className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Profile</div>
            <div className="text-xs text-text-tertiary mt-0.5">
              A named nono profile from ~/.config/nono/profiles, layered under the worktree grants.
            </div>
          </div>
          <select
            className="text-xs bg-background-secondary border border-black/60 rounded-[10px] px-2 py-1.5 text-text-primary"
            value={config.profile ?? ''}
            onChange={(e) => save({ ...config, profile: e.target.value || undefined })}
          >
            <option value="">None</option>
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <div className="border-t border-white/[0.06]" />

        <label className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Restrict outbound network</div>
            <div className="text-xs text-text-tertiary mt-0.5">
              Blocks outbound network for sandboxed commands. The local agent status port stays open.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.blockNet ?? false}
            aria-label="Restrict outbound network"
            onClick={() => save({ ...config, blockNet: !(config.blockNet ?? false) })}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ${
              config.blockNet ? 'bg-blue-500' : 'bg-white/15'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-150 ${
                config.blockNet ? 'translate-x-[18px]' : 'translate-x-[2px]'
              }`}
            />
          </button>
        </label>
      </div>
    </div>
  );
}
