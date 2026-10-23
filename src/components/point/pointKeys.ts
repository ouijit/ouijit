/**
 * Where a pointer lands. Anything a pointer can land on carries
 * `data-point-target`: space-separated keys, one element answering for several
 * targets (a task's only terminal is its task's row too). Paths are
 * percent-encoded so a key never holds a space or a quote.
 */

import type { PointTarget, TaskWithWorkspace } from '../../types';
import type { TerminalDisplayState } from '../../stores/terminalDisplay';

const enc = encodeURIComponent;

export const pointKey = {
  task: (projectPath: string, taskNumber: number) => `task:${enc(projectPath)}:${taskNumber}`,
  terminal: (ptyId: string) => `terminal:${enc(ptyId)}`,
  project: (projectPath: string) => `project:${enc(projectPath)}`,
  board: (projectPath: string) => `board:${enc(projectPath)}`,
  pr: (projectPath: string, number: number) => `pr:${enc(projectPath)}:${number}`,
  issue: (projectPath: string, id: string) => `issue:${enc(projectPath)}:${enc(id)}`,
  panel: (ptyId: string, panelId: string) => `panel:${enc(ptyId)}:${enc(panelId)}`,
  diffFile: (ptyId: string, path: string) => `diff:${enc(ptyId)}:${enc(path)}`,
  note: (ptyId: string, noteId: string) => `note:${enc(ptyId)}:${enc(noteId)}`,
};

/**
 * A key, or a diff line: lines carry only their number, so one is found inside
 * the file section answering to `file`.
 */
export type AnchorEntry = string | { file: string; line: number };

export interface PointWorld {
  displays: Record<string, TerminalDisplayState>;
  tasksByProject: Record<string, TaskWithWorkspace[]>;
}

function linkedTask(world: PointWorld, projectPath: string, linked: (task: TaskWithWorkspace) => boolean): string[] {
  const task = (world.tasksByProject[projectPath] ?? []).find(linked);
  return task ? [pointKey.task(projectPath, task.taskNumber)] : [];
}

function terminalChain(world: PointWorld, ptyId: string): string[] {
  const display = world.displays[ptyId];
  if (!display) return [pointKey.terminal(ptyId)];
  return [
    pointKey.terminal(ptyId),
    ...(display.taskId != null ? [pointKey.task(display.projectPath, display.taskId)] : []),
    pointKey.project(display.projectPath),
  ];
}

/**
 * The keys to look for, nearest first: the target itself, then what holds it,
 * so a target folded away or off on another page still has a ribbon.
 */
export function anchorChain(target: PointTarget, world: PointWorld): AnchorEntry[] {
  switch (target.kind) {
    case 'task':
      return [pointKey.task(target.projectPath, target.taskNumber), pointKey.project(target.projectPath)];
    case 'terminal':
      return terminalChain(world, target.ptyId);
    case 'project':
      return [pointKey.project(target.projectPath)];
    case 'board':
      return [pointKey.board(target.projectPath), pointKey.project(target.projectPath)];
    case 'pr':
      return [
        pointKey.pr(target.projectPath, target.number),
        ...linkedTask(world, target.projectPath, (t) => t.githubPrNumber === target.number),
        pointKey.project(target.projectPath),
      ];
    case 'issue':
      return [
        pointKey.issue(target.projectPath, target.id),
        ...linkedTask(
          world,
          target.projectPath,
          (t) => String(t.githubIssueNumber) === target.id || t.linearIssueIdentifier === target.id,
        ),
        pointKey.project(target.projectPath),
      ];
    case 'panel':
      return [pointKey.panel(target.ptyId, target.panelId), ...terminalChain(world, target.ptyId)];
    case 'diff':
      return [
        ...(target.noteId ? [pointKey.note(target.ptyId, target.noteId)] : []),
        ...(target.line != null ? [{ file: pointKey.diffFile(target.ptyId, target.path), line: target.line }] : []),
        pointKey.diffFile(target.ptyId, target.path),
        ...terminalChain(world, target.ptyId),
      ];
  }
}

/** Whether the thing pointed at still exists, so a pointer at a closed terminal or a trashed task goes. */
export function targetAlive(target: PointTarget, world: PointWorld): boolean {
  switch (target.kind) {
    case 'task':
      return (world.tasksByProject[target.projectPath] ?? []).some((t) => t.taskNumber === target.taskNumber);
    case 'terminal':
    case 'panel':
    case 'diff':
      return target.ptyId in world.displays;
    default:
      return true;
  }
}

/** The target in a few words, for when the ribbon stands in for it on something that holds it. */
export function describeTarget(target: PointTarget, world: PointWorld): string {
  switch (target.kind) {
    case 'task': {
      const task = (world.tasksByProject[target.projectPath] ?? []).find((t) => t.taskNumber === target.taskNumber);
      return task?.name || `T-${target.taskNumber}`;
    }
    case 'terminal':
      return world.displays[target.ptyId]?.label ?? 'a terminal';
    case 'project':
      return 'this project';
    case 'board':
      return 'the board';
    case 'pr':
      return `PR #${target.number}`;
    case 'issue':
      return /^\d+$/.test(target.id) ? `issue #${target.id}` : target.id;
    case 'panel':
      return 'a panel';
    case 'diff': {
      const file = target.path.split('/').pop() ?? target.path;
      return target.line != null ? `${file}:${target.line}` : file;
    }
  }
}
