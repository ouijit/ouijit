/**
 * Cross-launch session restore: gather a snapshot of currently open terminals
 * (with their UI state) and persist it to a global setting. Hydrated on next
 * launch by RestoreBanner / sessionRestore.
 */

import log from 'electron-log/renderer';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances, type OuijitTerminal } from './terminalReact';
import type { LastSessionSnapshot, SnapshotTerminal, SnapshotTerminalUi } from '../../types';

const sessionLog = log.scope('sessionSnapshot');

export const SNAPSHOT_KEY = 'lastSession:snapshot';

// ── Gather ───────────────────────────────────────────────────────────

function uiFor(term: OuijitTerminal): SnapshotTerminalUi {
  // Web preview: only persist user-set URLs. Auto-detected ones are tied to
  // a runner that no longer exists post-quit and would mislead the user.
  const webPreview =
    term.webPreviewUrl && !term.webPreviewUrlAutoDetected
      ? {
          url: term.webPreviewUrl,
          panelOpen: term.webPreviewPanelOpen,
          fullWidth: term.webPreviewFullWidth,
          splitRatio: term.webPreviewSplitRatio,
        }
      : null;

  const runner = term.runnerScript
    ? {
        scriptName: term.runnerScript.name || null,
        scriptCommand: term.runnerScript.command,
        panelOpen: term.runnerPanelOpen,
        fullWidth: term.runnerFullWidth,
      }
    : null;

  return {
    planPath: term.planPath,
    webPreview,
    runner,
  };
}

export function gatherSnapshot(): LastSessionSnapshot {
  const termStore = useTerminalStore.getState();
  const appStore = useAppStore.getState();

  const terminals: SnapshotTerminal[] = [];

  for (const [projectPath, ptyIds] of Object.entries(termStore.terminalsByProject)) {
    const activeIndex = termStore.activeIndices[projectPath] ?? -1;

    ptyIds.forEach((ptyId, ordinalInProject) => {
      const term = terminalInstances.get(ptyId);
      if (!term) return; // pending/disposed instance — skip
      if (term.isRunner) return; // runners are restored as state on their parent

      terminals.push({
        projectPath,
        taskNumber: term.taskId,
        worktreePath: term.worktreePath ?? null,
        worktreeBranch: term.worktreeBranch ?? null,
        sandboxed: term.sandboxed,
        label: term.label || null,
        ordinalInProject,
        isActiveInProject: ordinalInProject === activeIndex,
        ui: uiFor(term),
      });
    });
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    activeProjectPath: appStore.activeProjectPath,
    terminals,
  };
}

// ── Debounced save ───────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Tracks whether this session has ever had terminals open. Without this we'd
// overwrite the previous-launch snapshot during startup (when stores are
// transiently empty), clobbering it before the resume banner reads it.
let hadTerminalsThisSession = false;

export function scheduleSnapshotSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSnapshotNow, SAVE_DEBOUNCE_MS);
}

async function saveSnapshotNow(): Promise<void> {
  saveTimer = null;
  try {
    const snapshot = gatherSnapshot();
    if (snapshot.terminals.length === 0) {
      // Don't touch the persisted snapshot until we've seen at least one
      // terminal this session — otherwise we'd clobber the previous-launch
      // snapshot before the resume banner has had a chance to read it.
      if (!hadTerminalsThisSession) return;
      // Had terminals, now don't — user closed the last one. Clear snapshot
      // so the next launch doesn't show a stale resume banner.
      await window.api.globalSettings.set(SNAPSHOT_KEY, '');
      return;
    }
    hadTerminalsThisSession = true;
    await window.api.globalSettings.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (err) {
    sessionLog.warn('snapshot save failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ── Subscribe & wire ─────────────────────────────────────────────────

let installed = false;

/**
 * Subscribe to terminal/app-store changes that should trigger a re-snapshot.
 * Idempotent — calling more than once is a no-op.
 */
export function installSessionAutoSave(): void {
  if (installed) return;
  installed = true;

  // Snapshot whenever terminal layout / display state changes.
  useTerminalStore.subscribe(() => scheduleSnapshotSave());

  // Snapshot whenever active project changes (so resume nav lands correctly).
  useAppStore.subscribe(() => scheduleSnapshotSave());
}

// ── Read on launch ───────────────────────────────────────────────────

export async function readSnapshot(): Promise<LastSessionSnapshot | null> {
  try {
    const raw = await window.api.globalSettings.get(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSessionSnapshot;
    if (parsed.version !== 1 || !Array.isArray(parsed.terminals)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await window.api.globalSettings.set(SNAPSHOT_KEY, '');
  } catch {
    /* best-effort */
  }
}
