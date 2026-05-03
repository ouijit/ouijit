import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { setTerminalFontFamily, setTerminalFontSize } from './terminal/terminalReact';
import { FontPickerRow } from './FontPickerRow';

const DEFAULT_TERMINAL_FONT_SIZE = 14;
const MIN_TERMINAL_FONT_SIZE = 8;
const MAX_TERMINAL_FONT_SIZE = 32;

export function GlobalSettingsPanel() {
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [fontFamily, setFontFamily] = useState('');
  const [fontSize, setFontSize] = useState<number | null>(null);

  // Hydrate persisted settings on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.api.globalSettings.get('disableUpdates'),
      window.api.globalSettings.get('terminal:font-family'),
      window.api.globalSettings.get('terminal:font-size'),
    ]).then(([disableUpdates, family, size]) => {
      if (cancelled) return;
      setAutoUpdate(disableUpdates !== '1');
      setFontFamily(family ?? '');
      const parsed = parseFloat((size ?? '').trim());
      setFontSize(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
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

  const commitFontFamily = async (value: string) => {
    const trimmed = value.trim();
    setFontFamily(trimmed);
    setTerminalFontFamily(trimmed || null);
    await window.api.globalSettings.set('terminal:font-family', trimmed);
  };

  const commitFontSize = async (value: number | null) => {
    setFontSize(value);
    setTerminalFontSize(value);
    await window.api.globalSettings.set('terminal:font-size', value == null ? '' : String(value));
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
            <h2 className="text-sm font-semibold text-text-primary mb-4">Terminal</h2>
            <div
              className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06] bg-[var(--color-terminal-bg,#171717)]"
              style={{
                boxShadow:
                  '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
              }}
            >
              <FontPickerRow
                label="Font family"
                description="Pick a monospace font. Falls back gracefully if not installed."
                value={fontFamily}
                defaultLabel="Iosevka Term Extended"
                onCommit={commitFontFamily}
              />
              <NumberRow
                label="Font size"
                description={`In pixels. Defaults to ${DEFAULT_TERMINAL_FONT_SIZE}.`}
                value={fontSize}
                placeholder={String(DEFAULT_TERMINAL_FONT_SIZE)}
                suffix="px"
                min={MIN_TERMINAL_FONT_SIZE}
                max={MAX_TERMINAL_FONT_SIZE}
                onCommit={commitFontSize}
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-4">Updates</h2>
            <div
              className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06] bg-[var(--color-terminal-bg,#171717)]"
              style={{
                boxShadow:
                  '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
              }}
            >
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

interface NumberRowProps {
  label: string;
  description: string;
  value: number | null;
  placeholder?: string;
  suffix?: string;
  min?: number;
  max?: number;
  onCommit: (value: number | null) => void;
}

function NumberRow({ label, description, value, placeholder, suffix, min, max, onCommit }: NumberRowProps) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const lastCommittedRef = useRef(draft);
  // Mirror props/draft into refs so the unmount cleanup can flush without
  // capturing stale closure values.
  const draftRef = useRef(draft);
  const onCommitRef = useRef(onCommit);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const valueRef = useRef(value);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    onCommitRef.current = onCommit;
    minRef.current = min;
    maxRef.current = max;
    valueRef.current = value;
  });

  useEffect(() => {
    const next = value == null ? '' : String(value);
    setDraft(next);
    lastCommittedRef.current = next;
  }, [value]);

  const commitDraft = (raw: string) => {
    if (raw === lastCommittedRef.current) return;
    lastCommittedRef.current = raw;
    const trimmed = raw.trim();
    if (!trimmed) {
      onCommitRef.current(null);
      return;
    }
    const parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Reject invalid input — revert draft to last good value.
      const restored = valueRef.current == null ? '' : String(valueRef.current);
      setDraft(restored);
      lastCommittedRef.current = restored;
      return;
    }
    const clamped = Math.min(maxRef.current ?? parsed, Math.max(minRef.current ?? parsed, parsed));
    onCommitRef.current(clamped);
  };

  // Flush any pending edit if the row unmounts (e.g. user hits Escape to
  // close settings without first blurring the input).
  useEffect(() => {
    return () => {
      if (draftRef.current !== lastCommittedRef.current) {
        commitDraft(draftRef.current);
      }
    };
  }, []);

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-0.5">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          inputMode="numeric"
          value={draft}
          placeholder={placeholder}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commitDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-[5rem] px-3 py-1.5 text-sm bg-white/[0.04] border border-white/10 rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent focus:ring-2 focus:ring-accent-light"
        />
        {suffix && <span className="text-xs text-text-tertiary">{suffix}</span>}
      </div>
    </div>
  );
}
