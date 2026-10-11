import { useState, useEffect, useCallback } from 'react';
import type { NonoConfig } from '../../types';
import { CARD, FIELD, PRIMARY_BUTTON, ROW_ACTION } from './sandboxStyles';
import { QUIET_BUTTON } from './LensList';
import { useProjectStore } from '../../stores/projectStore';

interface NonoSandboxSectionProps {
  projectPath: string;
}

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
    async (next: NonoConfig) => {
      setConfig(next);
      await window.api.sandbox.setNonoConfig(projectPath, next);
      if (next.enabled !== config.enabled) await useProjectStore.getState().loadProjectConfig(projectPath);
    },
    [projectPath, config.enabled],
  );

  const unavailableReason = useProjectStore((s) => {
    const status =
      s.configProjectPath === projectPath ? s.sandboxStatuses.find((st) => st.providerId === 'nono') : undefined;
    return status && !status.available && status.detail !== 'Off' ? status.detail : undefined;
  });

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
    <section aria-label="nono" className={CARD}>
      <label className="flex items-center justify-between gap-4 px-4 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-primary">nono</span>
          <span className="mt-0.5 block text-xs text-text-tertiary">
            {unavailableReason ?? 'Kernel-level limits on the shell itself, in place on the worktree.'}
          </span>
        </span>
        <Toggle
          checked={config.enabled ?? false}
          label="Use nono"
          onClick={() => void save({ ...config, enabled: !(config.enabled ?? false) })}
        />
      </label>
      {config.enabled && (
        <>
          {/* Additional folders */}
          <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-text-primary">Additional folders</div>
                <div className="mt-0.5 text-xs text-text-tertiary">Beyond the worktree and git data.</div>
              </div>
              <button type="button" onClick={addFolder} className={ROW_ACTION}>
                + Add folder
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
                  className={`${FIELD} w-20 font-mono`}
                />
                <button type="button" onClick={addPort} className={ROW_ACTION}>
                  + Add
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
                <button type="button" onClick={openProfileEditor} className={ROW_ACTION}>
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
                  className={`${FIELD} h-56 w-full resize-y font-mono leading-relaxed`}
                />
                {profileError && <div className="text-xs text-error">{profileError}</div>}
                <div className="flex items-center justify-end gap-1.5">
                  {config.profile && (
                    <button type="button" onClick={resetProfile} className={`${ROW_ACTION} mr-auto`}>
                      Reset to default
                    </button>
                  )}
                  <button type="button" onClick={() => setProfileOpen(false)} className={QUIET_BUTTON}>
                    Cancel
                  </button>
                  <button type="button" onClick={saveProfile} className={PRIMARY_BUTTON}>
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
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
