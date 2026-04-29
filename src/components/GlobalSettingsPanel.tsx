import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';

export function GlobalSettingsPanel() {
  const [autoUpdate, setAutoUpdate] = useState(true);

  // Hydrate the toggle from the persisted setting on mount.
  useEffect(() => {
    let cancelled = false;
    window.api.globalSettings.get('disableUpdates').then((value) => {
      if (!cancelled) setAutoUpdate(value !== '1');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape returns to home — mirrors ProjectSettingsPanel's escape handler.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useAppStore.getState().setHomeActivePanel('home');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const toggleAutoUpdate = async () => {
    const next = !autoUpdate;
    setAutoUpdate(next);
    await window.api.globalSettings.set('disableUpdates', next ? '0' : '1');
  };

  return (
    <div
      className="flex flex-col h-full transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      {/* Fade overlay — content fades out under the header (mirrors ProjectSettingsPanel) */}
      <div
        className="pointer-events-none h-6 shrink-0 -mb-6 relative z-10"
        style={{ background: 'linear-gradient(to bottom, var(--color-background-primary, #1c1c1e), transparent)' }}
      />
      <div className="flex-1 overflow-y-auto settings-scrollable">
        <div className="flex items-center gap-3 px-6 pt-4 pb-2">
          <h1 className="text-base font-semibold text-text-primary">Settings</h1>
        </div>
        <div className="px-6 pt-4 pb-16 min-w-full max-w-2xl space-y-8">
          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-4">Updates</h2>
            <div className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06] bg-[var(--color-terminal-bg,#171717)]">
              <ToggleRow
                label="Check for updates automatically"
                description="When off, Ouijit will not contact any remote update service. You can also set OUIJIT_DISABLE_UPDATES=1 in your shell."
                checked={autoUpdate}
                onChange={toggleAutoUpdate}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ${
          checked ? 'bg-blue-500' : 'bg-white/15'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-150 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </label>
  );
}
