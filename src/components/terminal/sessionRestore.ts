/**
 * Walk a LastSessionSnapshot and respawn each terminal in its original
 * project/worktree, applying its persisted UI state. Skips silently when a
 * terminal is no longer restorable (project removed, task deleted/done,
 * worktree dir missing).
 */

import log from 'electron-log/renderer';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { addProjectTerminal } from './terminalActions';
import { suspendSnapshotSaves, resumeSnapshotSaves } from './sessionSnapshot';
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
    // Group by project, preserve original ordinal order
    const grouped = new Map<string, RestorableEntry[]>();
    for (const e of entries) {
      if (!grouped.has(e.project.path)) grouped.set(e.project.path, []);
      grouped.get(e.project.path)!.push(e);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.ordinalInProject - b.ordinalInProject);
    }

    for (const [projectPath, projectEntries] of grouped) {
      for (const entry of projectEntries) {
        const source = entry.source;
        try {
          await addProjectTerminal(projectPath, undefined, {
            existingWorktree: source.worktreePath
              ? {
                  path: source.worktreePath,
                  branch: source.worktreeBranch ?? '',
                  createdAt: '',
                  sandboxed: source.sandboxed,
                }
              : undefined,
            taskId: source.taskNumber ?? undefined,
            sandboxed: source.sandboxed,
            // Don't fire start/continue hooks on resume — that'd kick off a new
            // claude session. Restored terminals come back as plain shells.
            skipAutoHook: true,
            background: !source.isActiveInProject,
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
    }

    // Navigate to last-active project (terminals view)
    if (snapshot.activeProjectPath) {
      const project = projectByPath.get(snapshot.activeProjectPath);
      if (project) {
        useAppStore.getState().navigateToProject(snapshot.activeProjectPath, project);
        const projectStore = useProjectStore.getState();
        projectStore.setActivePanel('terminals');
        projectStore.setKanbanVisible(false);
      }
    }
  } finally {
    resumeSnapshotSaves();
  }
}
