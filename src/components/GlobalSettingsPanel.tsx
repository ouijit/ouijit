import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { setTerminalFontFamily, setTerminalFontSize } from './terminal/terminalReact';
import { setReadyAudioDisabled } from '../utils/notifications';
import { FontPickerRow } from './FontPickerRow';
import { MoveProjectsDialog } from './dialogs/MoveProjectsDialog';
import { DEFAULT_TERMINAL_HOTKEY } from '../terminalHotkey';
import type { AffectedProject, ProjectsFolderChangeAction } from '../types';
import log from 'electron-log/renderer';

const settingsLog = log.scope('globalSettings');

const DEFAULT_TERMINAL_FONT_SIZE = 14;
const MIN_TERMINAL_FONT_SIZE = 8;
const MAX_TERMINAL_FONT_SIZE = 32;

export function GlobalSettingsPanel() {
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [readyAudio, setReadyAudio] = useState(true);
  const [fontFamily, setFontFamily] = useState('');
  const [fontSize, setFontSize] = useState<number | null>(null);
  const [hotkey, setHotkey] = useState(DEFAULT_TERMINAL_HOTKEY);
  const [projectsFolder, setProjectsFolder] = useState<string | null>(null);
  const [moveDialog, setMoveDialog] = useState<{
    newFolder: string;
    projects: AffectedProject[];
  } | null>(null);

  // Hydrate persisted settings on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.api.globalSettings.get('disableUpdates'),
      window.api.globalSettings.get('disableReadyAudio'),
      window.api.globalSettings.get('terminal:font-family'),
      window.api.globalSettings.get('terminal:font-size'),
      window.api.getDefaultProjectsFolder(),
      window.api.getTerminalHotkey(),
    ])
      .then(([disableUpdates, disableReadyAudio, family, size, folder, terminalHotkey]) => {
        if (cancelled) return;
        setAutoUpdate(disableUpdates !== '1');
        setReadyAudio(disableReadyAudio !== '1');
        setFontFamily(family ?? '');
        const parsed = parseFloat((size ?? '').trim());
        setFontSize(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
        setProjectsFolder(folder);
        setHotkey(terminalHotkey);
      })
      .catch((error) => {
        settingsLog.error('failed to hydrate settings', {
          error: error instanceof Error ? error.message : String(error),
        });
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

  const toggleReadyAudio = async () => {
    const next = !readyAudio;
    setReadyAudio(next);
    // Update the notifications cache immediately so the change applies without a reload.
    setReadyAudioDisabled(!next);
    await window.api.globalSettings.set('disableReadyAudio', next ? '0' : '1');
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

  const commitHotkey = async (accelerator: string) => {
    const result = await window.api.setTerminalHotkey(accelerator);
    if (result.success) {
      setHotkey(result.accelerator);
    } else {
      useProjectStore
        .getState()
        .addToast(`Couldn't bind ${formatAccelerator(accelerator)} — it may be in use by another app`, 'error');
    }
  };

  const resetHotkey = async () => {
    const result = await window.api.setTerminalHotkey('');
    if (result.success) setHotkey(result.accelerator);
  };

  const handleChangeProjectsFolder = async () => {
    const result = await window.api.showFolderPicker({
      title: 'Choose Projects Folder',
      buttonLabel: 'Choose',
      defaultPath: projectsFolder ?? undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const newFolder = result.filePaths[0];

    // The main process owns the setting: it validates the folder, finds the
    // projects living in the current one, and commits when none are affected.
    const plan = await window.api.prepareProjectsFolderChange(newFolder);
    const { addToast } = useProjectStore.getState();
    if (plan.status === 'unchanged') return;
    if (plan.status === 'invalid') {
      addToast(plan.error ?? 'That folder cannot be used', 'error');
      return;
    }
    if (plan.status === 'committed') {
      setProjectsFolder(newFolder);
      addToast('Projects folder updated', 'success');
      return;
    }
    setMoveDialog({ newFolder, projects: plan.affected });
  };

  const handleMoveDialogClose = async (result: { action: ProjectsFolderChangeAction } | null) => {
    const dialog = moveDialog;
    setMoveDialog(null);
    if (!result || !dialog) return;
    const { addToast } = useProjectStore.getState();

    const outcome = await window.api.applyProjectsFolderChange(dialog.newFolder, result.action);
    for (const failure of outcome.failed) {
      addToast(`Could not move ${failure.path}: ${failure.error}`, 'error');
    }
    if (outcome.moved.length > 0) {
      addToast(`Moved ${outcome.moved.length} ${outcome.moved.length === 1 ? 'project' : 'projects'}`, 'success');
    }
    if (result.action === 'forget') {
      addToast(`Forgot ${dialog.projects.length} ${dialog.projects.length === 1 ? 'project' : 'projects'}`, 'info');
    }
    if (outcome.committed) {
      setProjectsFolder(dialog.newFolder);
    } else {
      addToast('The projects folder was not changed', 'info');
    }

    if (result.action !== 'keep') {
      const refreshed = await window.api.refreshProjects();
      useAppStore.getState().setProjects(refreshed);
      await useAppStore.getState().loadHomeRecents();
    }
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
        <div className="px-6 pt-4 pb-16 min-w-full max-w-2xl space-y-8">
          <div>
            <h1 className="text-base font-semibold text-text-primary">App Settings</h1>
            <p className="text-xs text-text-tertiary mt-1">
              Settings that apply to every project. Scripts, hooks, sandbox, and worktree options are set in each
              project's settings.
            </p>
          </div>
          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-4">Projects</h2>
            <div
              className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06] bg-[var(--color-terminal-bg,#171717)]"
              style={{
                boxShadow:
                  '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
              }}
            >
              <PathRow
                label="Projects folder"
                description="New projects are created here. Changing it lets you move or forget existing projects."
                value={projectsFolder}
                buttonLabel="Change…"
                onChoose={handleChangeProjectsFolder}
              />
            </div>
          </section>

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
              <HotkeyRecorderRow
                label="Quick terminal hotkey"
                description="Global shortcut to open the standalone terminal window from anywhere."
                value={hotkey}
                isDefault={hotkey === DEFAULT_TERMINAL_HOTKEY}
                onCommit={commitHotkey}
                onReset={resetHotkey}
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
                description="When off, Ouijit won't contact the update service or download new versions."
                checked={autoUpdate}
                onChange={toggleAutoUpdate}
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-4">Sound</h2>
            <div
              className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06] bg-[var(--color-terminal-bg,#171717)]"
              style={{
                boxShadow:
                  '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
              }}
            >
              <ToggleRow
                label="Play a sound when a task is ready"
                description="Plays a chime when a terminal returns to the ready state."
                checked={readyAudio}
                onChange={toggleReadyAudio}
              />
            </div>
          </section>
        </div>
      </div>
      {moveDialog && (
        <MoveProjectsDialog
          newFolder={moveDialog.newFolder}
          projects={moveDialog.projects}
          onClose={handleMoveDialogClose}
        />
      )}
    </div>
  );
}

interface PathRowProps {
  label: string;
  description: string;
  value: string | null;
  buttonLabel: string;
  onChoose: () => void;
}

function PathRow({ label, description, value, buttonLabel, onChoose }: PathRowProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-0.5">{description}</div>
        <div className="text-xs font-mono text-text-secondary mt-1.5 truncate" title={value ?? undefined}>
          {value ?? '…'}
        </div>
      </div>
      <button type="button" className="btn-secondary shrink-0" onClick={onChoose}>
        {buttonLabel}
      </button>
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

// ── Hotkey recorder ──────────────────────────────────────────────────

const MODIFIER_SYMBOLS: Record<string, string> = {
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
};

/** Render an Electron accelerator (e.g. "Control+`") as symbols ("⌃ `"). */
function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => MODIFIER_SYMBOLS[part] ?? part)
    .join(' ');
}

/** Map a physical key code to its Electron accelerator key token, or null. */
function keyTokenFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  const named: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    Escape: 'Escape',
    Tab: 'Tab',
    Enter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  return named[code] ?? null;
}

/**
 * Build an Electron accelerator from a keydown event, or null if it isn't a
 * usable global shortcut (no real modifier, or an unmappable key). Function
 * keys are allowed without a modifier.
 */
function buildAccelerator(e: KeyboardEvent): string | null {
  const key = keyTokenFromCode(e.code);
  if (!key) return null;
  const isFunctionKey = /^F\d{1,2}$/.test(key);
  const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
  if (!hasModifier && !isFunctionKey) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('Command');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

interface HotkeyRecorderRowProps {
  label: string;
  description: string;
  value: string;
  isDefault: boolean;
  onCommit: (accelerator: string) => void;
  onReset: () => void;
}

function HotkeyRecorderRow({ label, description, value, isDefault, onCommit, onReset }: HotkeyRecorderRowProps) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Escape cancels; lone modifier presses keep waiting for the real key.
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const accelerator = buildAccelerator(e);
      if (accelerator) {
        setRecording(false);
        onCommit(accelerator);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, onCommit]);

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-0.5">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!isDefault && (
          <button
            type="button"
            className="text-xs text-text-tertiary hover:text-text-secondary"
            onClick={() => {
              setRecording(false);
              onReset();
            }}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={() => setRecording((r) => !r)}
          className={`min-w-[6rem] px-3 py-1.5 text-sm font-mono rounded-md border outline-none transition-colors ${
            recording
              ? 'border-accent ring-2 ring-accent-light text-text-primary bg-white/[0.04]'
              : 'border-white/10 text-text-primary bg-white/[0.04] hover:border-white/20'
          }`}
        >
          {recording ? 'Press keys…' : formatAccelerator(value)}
        </button>
      </div>
    </div>
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
