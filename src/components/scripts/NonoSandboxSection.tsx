import { useState, useEffect, useCallback } from 'react';
import type { NonoConfig } from '../../types';

interface NonoSandboxSectionProps {
  projectPath: string;
}

const CARD =
  'glass-bevel relative border border-bezel rounded-[14px] overflow-hidden bg-terminal-bg divide-y divide-ink/[0.06]';

const PILL_BTN =
  'shrink-0 text-xs font-medium text-text-secondary bg-background-secondary border border-bezel rounded-[10px] px-2.5 py-1.5 hover:bg-background-tertiary hover:text-text-primary transition-colors';

/** Config surface for the nono backend. Controls only — no exposition. */
const STARTER_PROFILE = `{
  "extends": "ouijit"
}
`;

export function NonoSandboxSection({ projectPath }: NonoSandboxSectionProps) {
  const [config, setConfig] = useState<NonoConfig>({});
  const [portDraft, setPortDraft] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.api.sandbox.nonoConfig(projectPath).then((cfg) => {
      if (!active) return;
      setConfig(cfg);
    });
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

  const allowPaths = config.allowPaths ?? [];
  const openPorts = config.openPorts ?? [];

  const addFolder = async () => {
    const res = await window.api.showFolderPicker();
    if (res.canceled || res.filePaths.length === 0) return;
    const picked = res.filePaths[0];
    if (allowPaths.includes(picked)) return;
    save({ ...config, allowPaths: [...allowPaths, picked] });
  };
  const removeFolder = (p: string) => save({ ...config, allowPaths: allowPaths.filter((x) => x !== p) });

  const addPort = () => {
    const n = Number(portDraft.trim());
    if (!Number.isInteger(n) || n <= 0 || n > 65535 || openPorts.includes(n)) return;
    save({ ...config, openPorts: [...openPorts, n] });
    setPortDraft('');
  };
  const removePort = (n: number) => save({ ...config, openPorts: openPorts.filter((x) => x !== n) });

  const openProfileEditor = () => {
    setProfileDraft(config.profile && config.profile.trim().length > 0 ? config.profile : STARTER_PROFILE);
    setProfileError(null);
    setProfileOpen(true);
  };
  const saveProfile = () => {
    const text = profileDraft.trim();
    if (text.length > 0) {
      try {
        JSON.parse(text);
      } catch (e) {
        setProfileError(e instanceof Error ? e.message : 'Invalid JSON');
        return;
      }
    }
    setProfileError(null);
    save({ ...config, profile: text.length > 0 ? text : undefined });
    setProfileOpen(false);
  };
  const resetProfile = () => {
    setProfileError(null);
    save({ ...config, profile: undefined });
    setProfileOpen(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-tertiary">
        Runs a task's commands with OS-level access limits, scoped to its worktree and git data. Turn it on from a
        task's menu.
      </p>

      <div className={CARD}>
        {/* Additional folders */}
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-text-primary">Additional folders</div>
              <div className="mt-0.5 text-xs text-text-tertiary">Beyond the worktree and git data.</div>
            </div>
            <button type="button" onClick={addFolder} className={PILL_BTN}>
              Add folder
            </button>
          </div>
          {allowPaths.length > 0 && (
            <div className="flex flex-col gap-1">
              {allowPaths.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-text-secondary">{p}</code>
                  <button
                    type="button"
                    onClick={() => removeFolder(p)}
                    aria-label={`Remove ${p}`}
                    className="px-1 text-xs text-text-tertiary hover:text-text-primary"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Network */}
        <label className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm text-text-primary">Block outbound network</span>
          <Toggle
            checked={config.blockNet ?? false}
            label="Block outbound network"
            onClick={() => save({ ...config, blockNet: !(config.blockNet ?? false) })}
          />
        </label>

        {/* Allowed ports */}
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-text-primary">Allowed ports</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={portDraft}
                placeholder="3000"
                aria-label="Add a port"
                onChange={(e) => setPortDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addPort();
                }}
                className="w-16 rounded-[10px] border border-bezel bg-background-secondary px-2 py-1.5 text-xs text-text-primary"
              />
              <button type="button" onClick={addPort} className={PILL_BTN}>
                Add
              </button>
            </div>
          </div>
          {openPorts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {openPorts.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center gap-1 rounded-full border border-bezel bg-background-secondary py-0.5 pl-2 pr-1 text-xs text-text-secondary"
                >
                  {n}
                  <button
                    type="button"
                    onClick={() => removePort(n)}
                    aria-label={`Remove port ${n}`}
                    className="px-1 text-text-tertiary hover:text-text-primary"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sandbox profile — full escape hatch, peer to Lima's YAML editor */}
      <div className={CARD}>
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-text-primary">Sandbox profile</div>
              <div className="mt-0.5 text-xs text-text-tertiary">
                {config.profile
                  ? 'Using a custom profile for this project.'
                  : 'Edit this project’s nono policy directly. Ouijit still grants the worktree, git data, hook port, and caches on top.'}
              </div>
            </div>
            {!profileOpen && (
              <button type="button" onClick={openProfileEditor} className={PILL_BTN}>
                {config.profile ? 'Edit' : 'Customize'}
              </button>
            )}
          </div>
          {profileOpen && (
            <div className="flex flex-col gap-2">
              <textarea
                value={profileDraft}
                onChange={(e) => {
                  setProfileDraft(e.target.value);
                  setProfileError(null);
                }}
                spellCheck={false}
                aria-label="nono profile JSON"
                className="h-56 w-full resize-y rounded-[10px] border border-bezel bg-background-secondary px-3 py-2 font-mono text-xs leading-relaxed text-text-primary outline-none"
              />
              {profileError && <div className="text-xs text-error">{profileError}</div>}
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={saveProfile} className={PILL_BTN}>
                  Save
                </button>
                <button type="button" onClick={() => setProfileOpen(false)} className={PILL_BTN}>
                  Cancel
                </button>
                {config.profile && (
                  <button
                    type="button"
                    onClick={resetProfile}
                    className="ml-auto text-xs text-text-tertiary hover:text-text-primary"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ${
        checked ? 'bg-accent' : 'bg-ink/15'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-accent-ink transition-transform duration-150 ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
