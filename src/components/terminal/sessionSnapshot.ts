/**
 * Cross-launch session restore: gather a snapshot of currently open terminals
 * (with their UI state) and persist it to a global setting. Hydrated on next
 * launch by RestoreBanner / sessionRestore.
 */

import log from 'electron-log/renderer';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances, type OuijitTerminal } from './terminalReact';
import type { LastSessionSnapshot, SnapshotPanel, SnapshotTerminal, SnapshotTerminalUi } from '../../types';

const sessionLog = log.scope('sessionSnapshot');

export const SNAPSHOT_KEY = 'lastSession:snapshot';

// ── Gather ───────────────────────────────────────────────────────────

function uiFor(term: OuijitTerminal): SnapshotTerminalUi {
  const panels: SnapshotPanel[] = [];
  let activePanelIndex: number | null = null;

  for (const p of term.panels) {
    const before = panels.length;
    switch (p.kind) {
      case 'runner':
        // Persist the script (not the live PTY) for one-click re-run.
        panels.push({ kind: 'runner', scriptName: p.scriptName, scriptCommand: p.scriptCommand });
        break;
      case 'webPreview':
        // Only persist user-set URLs. Auto-detected ones are tied to a runner
        // that no longer exists post-quit and would mislead the user.
        if (p.url && !p.urlAutoDetected) panels.push({ kind: 'webPreview', url: p.url });
        break;
      case 'plan':
        panels.push({ kind: 'plan', planPath: p.planPath });
        break;
    }
    if (panels.length > before && p.id === term.activePanelId) activePanelIndex = panels.length - 1;
  }

  return { panels, activePanelIndex, panelFullWidth: term.panelFullWidth, diffPanelOpen: term.diffPanelOpen };
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
        ptyId: term.ptyId,
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
// While restoreSession is mutating the stores, every change schedules a save
// that would re-populate the snapshot we're trying to clear. Suspend saves
// for the duration of restore; the post-restore clear has the final word.
let savesSuspended = false;

export function suspendSnapshotSaves(): void {
  savesSuspended = true;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

export function resumeSnapshotSaves(): void {
  savesSuspended = false;
}

export function scheduleSnapshotSave(): void {
  if (savesSuspended) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSnapshotNow, SAVE_DEBOUNCE_MS);
}

// Gather the current state and fire the persist IPC. Kept synchronous (the IPC
// is dispatched without awaiting) so it can run inside a `beforeunload` handler,
// where the renderer tears down before any promise would resolve — the message
// is still posted to the main process, which writes it.
function persistSnapshotNow(): void {
  const snapshot = gatherSnapshot();
  sessionLog.info('snapshot save', {
    terminals: snapshot.terminals.map((t) => ({
      ptyId: t.ptyId,
      panels: (t.ui.panels ?? []).map(
        (p) =>
          `${p.kind}:${p.kind === 'plan' ? p.planPath : p.kind === 'webPreview' ? p.url : (p.scriptCommand ?? '')}`,
      ),
      active: t.ui.activePanelIndex,
      diff: t.ui.diffPanelOpen,
    })),
  });
  if (snapshot.terminals.length === 0) {
    // Don't touch the persisted snapshot until we've seen at least one terminal
    // this session — otherwise we'd clobber the previous-launch snapshot before
    // the resume banner has had a chance to read it.
    if (!hadTerminalsThisSession) return;
    // Had terminals, now don't — user closed the last one. Clear snapshot so
    // the next launch doesn't show a stale resume banner.
    void window.api.globalSettings.set(SNAPSHOT_KEY, '');
    return;
  }
  hadTerminalsThisSession = true;
  void window.api.globalSettings.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

async function saveSnapshotNow(): Promise<void> {
  saveTimer = null;
  if (savesSuspended) return;
  try {
    persistSnapshotNow();
  } catch (err) {
    sessionLog.warn('snapshot save failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Persist immediately, cancelling any pending debounced save. Called on renderer
 * unload (refresh / reload / quit) so changes made within the debounce window —
 * e.g. a panel attached moments before a refresh — aren't lost. Without this the
 * pending timer is discarded when the renderer tears down and those changes
 * never reach the snapshot, so reconnect restores a stale layout.
 */
export function flushSnapshotSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (savesSuspended) return;
  try {
    persistSnapshotNow();
  } catch {
    /* best-effort on unload */
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

  // Flush any pending save before the renderer unloads (refresh / reload / quit)
  // so changes made within the debounce window survive. The PTYs outlive a
  // reload, and reconnectOrphanedSessions reads this snapshot to restore each
  // terminal's panels — a dropped pending save means they come back bare.
  window.addEventListener('beforeunload', flushSnapshotSave);
  window.addEventListener('pagehide', flushSnapshotSave);
}

// ── Read on launch ───────────────────────────────────────────────────

export async function readSnapshot(): Promise<LastSessionSnapshot | null> {
  try {
    const raw = await window.api.globalSettings.get(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSessionSnapshot;
    if (parsed.version !== 1 || !Array.isArray(parsed.terminals)) return null;
    sessionLog.info('snapshot read', {
      terminals: parsed.terminals.map((t) => ({
        ptyId: t.ptyId,
        panels: (t.ui?.panels ?? []).map((p) => p.kind),
      })),
    });
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  // Cancel any pending save so it doesn't fire after the clear and re-populate
  // the key with the just-restored state.
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    await window.api.globalSettings.set(SNAPSHOT_KEY, '');
  } catch {
    /* best-effort */
  }
}
