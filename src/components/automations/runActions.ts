import type { AutomationRun } from '../../automations/types';
import { joinStack, useAppStore } from '../../stores/appStore';
import { stackOf, useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { loadTasks } from '../../stores/projectDataStore';
import { addProjectTerminal, reconnectTerminal } from '../terminal/terminalActions';
import { isActiveSandbox } from '../../types';

function showInFront(ptyId: string, projectPath: string): void {
  const { selection } = useAppStore.getState();
  useAppStore
    .getState()
    .showTerminal(ptyId, joinStack(selection, projectPath, stackOf({ ptyId, projectPath, taskId: null })));
}

/**
 * Opens a run: its terminal while it is going, the agent's session continued
 * in the run's worktree once it has ended, or the task it became. Returns false
 * when there is nothing to open but its last screen.
 */
export async function openRun(run: AutomationRun, label: string): Promise<boolean> {
  const opening = await window.api.automations.openRun(run.id);
  switch (opening.kind) {
    case 'live': {
      const term = await reconnectTerminal(opening.session, { label });
      if (!term) return false;
      showInFront(opening.session.ptyId, run.projectPath);
      return true;
    }
    case 'continue': {
      const opened = await addProjectTerminal(
        run.projectPath,
        opening.command ? { name: label, command: opening.command, source: 'custom', priority: 0 } : undefined,
        {
          existingWorktree: { path: opening.worktreePath, branch: opening.branch ?? '', createdAt: '' },
          sandboxProvider: isActiveSandbox(opening.sandbox) ? opening.sandbox : 'none',
          skipAutoHook: true,
          label,
          env: opening.env,
        },
      );
      const [front] = useTerminalStore.getState().order;
      if (opened && front) showInFront(front, run.projectPath);
      return opened;
    }
    case 'task':
      await openTask(run.projectPath);
      return true;
    case 'output':
      return false;
  }
}

async function openTask(projectPath: string): Promise<void> {
  await loadTasks(projectPath);
  useAppStore.getState().openPage(projectPath, 'board');
}

export async function makeTask(run: AutomationRun): Promise<void> {
  const result = await window.api.automations.makeTask(run.id);
  if ('error' in result) {
    useProjectStore.getState().addToast(result.error, 'error');
    return;
  }
  useProjectStore.getState().addToast(`T-${result.taskNumber} is on the board`, 'info');
  await openTask(run.projectPath);
}

export async function runNow(automationId: string, label: string, projectPath: string): Promise<void> {
  const run = await window.api.automations.runNow(automationId);
  if (run.state === 'skipped') {
    useProjectStore.getState().addToast(run.reason ?? 'Skipped', 'info');
    return;
  }
  if (run.state === 'queued') {
    useProjectStore.getState().addToast('Queued behind other runs', 'info');
    return;
  }
  if (run.ptyId) await openRun({ ...run, projectPath }, label);
}
