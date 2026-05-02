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
import type { LastSessionSnapshot, Project, SnapshotTerminal } from '../../types';

const restoreLog = log.scope('sessionRestore');

interface RestoreCounts {
  total: number;
  projects: number;
}

/** Inspect snapshot terminals against current state (project list, tasks, fs). */
export async function countRestorable(snapshot: LastSessionSnapshot): Promise<RestoreCounts> {
  const projects = useAppStore.getState().projects;
  const projectByPath = new Map(projects.map((p) => [p.path, p]));

  let total = 0;
  const seenProjects = new Set<string>();
  for (const t of snapshot.terminals) {
    if (await isStillRestorable(t, projectByPath)) {
      total++;
      seenProjects.add(t.projectPath);
    }
  }
  return { total, projects: seenProjects.size };
}

async function isStillRestorable(entry: SnapshotTerminal, projectByPath: Map<string, Project>): Promise<boolean> {
  if (!projectByPath.has(entry.projectPath)) return false;

  // Task lookup doubles as worktree validity — the task row stores the path.
  // If the task is gone or marked done since quit, drop the entry.
  if (entry.taskNumber != null) {
    const task = await window.api.task.getByNumber(entry.projectPath, entry.taskNumber);
    if (!task) return false;
    if (task.status === 'done') return false;
  }

  return true;
}

export async function restoreSession(snapshot: LastSessionSnapshot): Promise<void> {
  const projects = useAppStore.getState().projects;
  const projectByPath = new Map(projects.map((p) => [p.path, p]));

  // Group by project, preserve original ordinal order
  const grouped = new Map<string, SnapshotTerminal[]>();
  for (const t of snapshot.terminals) {
    if (!grouped.has(t.projectPath)) grouped.set(t.projectPath, []);
    grouped.get(t.projectPath)!.push(t);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.ordinalInProject - b.ordinalInProject);
  }

  for (const [projectPath, entries] of grouped) {
    for (const entry of entries) {
      if (!(await isStillRestorable(entry, projectByPath))) {
        restoreLog.info('skipping unrestorable terminal', {
          projectPath,
          taskNumber: entry.taskNumber,
        });
        continue;
      }

      try {
        await addProjectTerminal(projectPath, undefined, {
          existingWorktree: entry.worktreePath
            ? {
                path: entry.worktreePath,
                branch: entry.worktreeBranch ?? '',
                createdAt: '',
                sandboxed: entry.sandboxed,
              }
            : undefined,
          taskId: entry.taskNumber ?? undefined,
          sandboxed: entry.sandboxed,
          // Don't fire start/continue hooks on resume — that'd kick off a new
          // claude session. Restored terminals come back as plain shells.
          skipAutoHook: true,
          background: !entry.isActiveInProject,
          initialUiState: entry.ui,
        });
      } catch (err) {
        restoreLog.warn('failed to restore terminal', {
          projectPath,
          taskNumber: entry.taskNumber,
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
}
