/**
 * Walk a LastSessionSnapshot and respawn each terminal in its original
 * project/worktree, applying its persisted UI state. Skips silently when a
 * terminal is no longer restorable (project removed, task deleted/done,
 * worktree dir missing).
 */

import log from 'electron-log/renderer';
import { useAppStore } from '../../stores/appStore';
import { addProjectTerminal } from './terminalActions';
import { suspendSnapshotSaves, resumeSnapshotSaves, snapshotRecency } from './sessionSnapshot';
import type { LastSessionSnapshot, Project, SnapshotTerminal, TaskStatus } from '../../types';

const restoreLog = log.scope('sessionRestore');

export interface RestorableEntry {
  project: Project;
  taskNumber: number | null;
  taskName: string | null;
  taskStatus: TaskStatus | null;
  label: string | null;
  ordinalInProject: number;
  /** Original snapshot row — carried so restoreSession can spawn without re-fetching tasks. */
  source: SnapshotTerminal;
}

interface RestoreCounts {
  total: number;
  tasks: number;
  projects: number;
}

/**
 * Walk the snapshot, dropping entries whose project/task is gone, and return
 * a list enriched with the current project + task metadata. Counts are
 * derived from this list so banner copy and the expanded preview never
 * disagree.
 */
export async function listRestorable(snapshot: LastSessionSnapshot): Promise<RestorableEntry[]> {
  const projects = useAppStore.getState().projects;
  const projectByPath = new Map(projects.map((p) => [p.path, p]));

  const out: RestorableEntry[] = [];
  for (const t of snapshot.terminals) {
    const project = projectByPath.get(t.projectPath);
    if (!project) continue;

    let taskName: string | null = null;
    let taskStatus: TaskStatus | null = null;
    if (t.taskNumber != null) {
      const task = await window.api.task.getByNumber(t.projectPath, t.taskNumber);
      if (!task || task.status === 'done') continue;
      taskName = task.name ?? null;
      taskStatus = task.status;
    }

    out.push({
      project,
      taskNumber: t.taskNumber,
      taskName,
      taskStatus,
      label: t.label,
      ordinalInProject: t.ordinalInProject,
      source: t,
    });
  }
  return out;
}

export function summarizeRestorable(entries: RestorableEntry[]): RestoreCounts {
  const projectSet = new Set(entries.map((e) => e.project.path));
  const taskSet = new Set(entries.filter((e) => e.taskNumber != null).map((e) => `${e.project.path}#${e.taskNumber}`));
  return { total: entries.length, tasks: taskSet.size, projects: projectSet.size };
}

export async function restoreSession(snapshot: LastSessionSnapshot, entries: RestorableEntry[]): Promise<void> {
  const projects = useAppStore.getState().projects;
  const projectByPath = new Map(projects.map((p) => [p.path, p]));

  // Suspend snapshot auto-save during restore: every spawn/navigate fires a
  // store update that would otherwise schedule a save and re-populate the
  // snapshot key the caller is about to clear.
  suspendSnapshotSaves();
  try {
    // Each restored terminal enters at the front, so restoring from the back
    // of the order leaves it as it was.
    const rank = new Map(snapshotRecency(snapshot).map((t, i) => [t, i]));
    const backToFront = [...entries].sort((a, b) => (rank.get(b.source) ?? 0) - (rank.get(a.source) ?? 0));

    for (const entry of backToFront) {
      const projectPath = entry.project.path;
      const source = entry.source;
      try {
        const restoredProvider = source.sandboxProvider;
        await addProjectTerminal(projectPath, undefined, {
          existingWorktree: source.worktreePath
            ? {
                path: source.worktreePath,
                branch: source.worktreeBranch ?? '',
                createdAt: '',
                sandboxProvider: restoredProvider,
              }
            : undefined,
          taskId: source.taskNumber ?? undefined,
          sandboxProvider: restoredProvider,
          // Carry through a user rename so a restored card keeps its name
          // instead of snapping back to the task name.
          label: source.label ?? undefined,
          // Don't fire start/continue hooks on resume — that'd kick off a new
          // claude session. Restored terminals come back as plain shells.
          skipAutoHook: true,
          initialUiState: source.ui,
        });
      } catch (err) {
        restoreLog.warn('failed to restore terminal', {
          projectPath,
          taskNumber: source.taskNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (snapshot.activeProjectPath && projectByPath.has(snapshot.activeProjectPath)) {
      useAppStore.getState().showProjectTerminals(snapshot.activeProjectPath);
    }
  } finally {
    resumeSnapshotSaves();
  }
}
