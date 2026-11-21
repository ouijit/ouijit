import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { setTerminalFontFamily, setTerminalFontSize } from '../terminal/terminalReact';
import { setReadyAudioDisabled } from '../../utils/notifications';
import { FontPickerRow } from '../FontPickerRow';
import { ThemeSettingsSection } from '../ThemeSettingsSection';
import { ToggleRow } from '../ui/SettingsRows';
import { MoveProjectsDialog } from '../dialogs/MoveProjectsDialog';
import type { AffectedProject, ProjectsFolderChangeAction } from '../../types';
import log from 'electron-log/renderer';

const settingsLog = log.scope('globalSettings');

const DEFAULT_TERMINAL_FONT_SIZE = 14;
const MIN_TERMINAL_FONT_SIZE = 8;
const MAX_TERMINAL_FONT_SIZE = 32;

const PANEL =
  'glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg';

function useStored<T>(read: () => Promise<T>, apply: (value: T) => void): void {
  useEffect(() => {
    let cancelled = false;
    read()
      .then((value) => {
        if (!cancelled) apply(value);
      })
      .catch((error) => {
        settingsLog.error('failed to hydrate settings', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function AppGeneralSettings() {
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [readyAudio, setReadyAudio] = useState(true);
  const [projectsFolder, setProjectsFolder] = useState<string | null>(null);
  const [moveDialog, setMoveDialog] = useState<{
    newFolder: string;
    projects: AffectedProject[];
  } | null>(null);

  useStored(
    () =>
      Promise.all([
        window.api.globalSettings.get('disableUpdates'),
        window.api.globalSettings.get('disableReadyAudio'),
        window.api.getDefaultProjectsFolder(),
      ]),
    ([disableUpdates, disableReadyAudio, folder]) => {
      setAutoUpdate(disableUpdates !== '1');
      setReadyAudio(disableReadyAudio !== '1');
      setProjectsFolder(folder);
    },
  );

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
    <>
      <div className={PANEL}>
        <PathRow
          label="Projects folder"
          description="New projects are created here. Changing it lets you move or forget existing projects."
          value={projectsFolder}
          buttonLabel="Change…"
          onChoose={handleChangeProjectsFolder}
        />
        <ToggleRow
          label="Check for updates automatically"
          description="When off, Ouijit won't contact the update service or download new versions."
          checked={autoUpdate}
          onChange={toggleAutoUpdate}
        />
        <ToggleRow
          label="Play a sound when a task is ready"
          description="Plays a chime when a terminal returns to the ready state."
          checked={readyAudio}
          onChange={toggleReadyAudio}
        />
      </div>
      {moveDialog && (
        <MoveProjectsDialog
          newFolder={moveDialog.newFolder}
          projects={moveDialog.projects}
          onClose={handleMoveDialogClose}
        />
      )}
    </>
  );
}

export function AppAppearanceSettings() {
  const [fontFamily, setFontFamily] = useState('');
  const [fontSize, setFontSize] = useState<number | null>(null);

  useStored(
    () =>
      Promise.all([
        window.api.globalSettings.get('terminal:font-family'),
        window.api.globalSettings.get('terminal:font-size'),
      ]),
    ([family, size]) => {
      setFontFamily(family ?? '');
      const parsed = parseFloat((size ?? '').trim());
      setFontSize(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    },
  );

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
    <>
      <ThemeSettingsSection />
      <section>
        <h2 className="text-sm font-semibold text-text-primary mb-4">Terminal</h2>
        <div className={PANEL}>
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
    </>
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
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
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
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
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
          className="w-[5rem] px-3 py-1.5 text-sm bg-ink/[0.04] border border-ink/10 rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent focus:ring-2 focus:ring-accent-light"
        />
        {suffix && <span className="text-xs text-text-tertiary">{suffix}</span>}
      </div>
    </div>
  );
}
