import log from 'electron-log/renderer';
import { terminalInstances } from '../components/terminal/terminalRegistry';
import { useAppStore } from '../stores/appStore';
import { usePointerStore } from '../stores/pointerStore';
import { useTerminalStore } from '../stores/terminalStore';
import type { CliPointOp, CliPointResponse, PointTarget } from '../types';

const cliPointsLog = log.scope('cliPoints');

async function missing(target: PointTarget): Promise<string | null> {
  const { displayStates } = useTerminalStore.getState();
  switch (target.kind) {
    case 'task':
      return (await window.api.task.getByNumber(target.projectPath, target.taskNumber))
        ? null
        : `Task ${target.taskNumber} not found`;
    case 'project':
    case 'board':
    case 'pr':
    case 'issue':
      return useAppStore.getState().projects.some((p) => p.path === target.projectPath)
        ? null
        : `${target.projectPath} is not a project in Ouijit`;
    case 'terminal':
    case 'diff':
      return target.ptyId in displayStates ? null : `No terminal ${target.ptyId}`;
    case 'panel':
      return terminalInstances.get(target.ptyId)?.panels.some((p) => p.id === target.panelId)
        ? null
        : `No panel ${target.panelId} on ${target.ptyId}`;
  }
}

async function noteTarget(fromPtyId: string, noteId: string): Promise<PointTarget | string> {
  const display = useTerminalStore.getState().displayStates[fromPtyId];
  if (!display) return `No terminal ${fromPtyId}`;
  const worktree = terminalInstances.get(fromPtyId)?.worktreePath || display.projectPath;
  const note = (await window.api.diffNotes.list(worktree)).find((n) => n.id === noteId);
  if (!note) return `No note ${noteId}`;
  return { kind: 'diff', ptyId: fromPtyId, path: note.path, line: note.line, noteId };
}

/** The CLI sends an absolute path; the diff keys files by their path in the worktree. */
function inWorktree(target: PointTarget): PointTarget {
  if (target.kind !== 'diff' || !target.path.startsWith('/')) return target;
  const display = useTerminalStore.getState().displayStates[target.ptyId];
  const root = terminalInstances.get(target.ptyId)?.worktreePath || display?.projectPath;
  if (!root || !target.path.startsWith(`${root}/`)) return target;
  return { ...target, path: target.path.slice(root.length + 1) };
}

async function handleOp(op: CliPointOp): Promise<CliPointResponse> {
  if (op.action === 'clear') {
    usePointerStore.getState().dismiss(op.fromPtyId);
    return { ok: true };
  }
  const resolved = op.action === 'note' ? await noteTarget(op.fromPtyId, op.noteId ?? '') : op.target;
  if (!resolved) return { ok: false, error: 'Missing target' };
  if (typeof resolved === 'string') return { ok: false, error: resolved };
  const target = inWorktree(resolved);
  const error = await missing(target);
  if (error) return { ok: false, error };
  usePointerStore.getState().point({ from: op.fromPtyId, target });
  return { ok: true, target };
}

/** Handle `ouijit point`. Install once for the life of the renderer. */
export function installCliPointListener(): () => void {
  return window.api.cliPoints.onOp((op) => {
    void handleOp(op)
      .catch((err): CliPointResponse => {
        const error = err instanceof Error ? err.message : String(err);
        cliPointsLog.warn('point op failed', { fromPtyId: op.fromPtyId, action: op.action, error });
        return { ok: false, error };
      })
      .then((response) => window.api.cliPoints.respond(op.requestId, response));
  });
}
