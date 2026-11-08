import log from 'electron-log/renderer';
import { focusTerminal, openProject, openProjectPage, openTaskTerminal } from '../components/navigation';
import { terminalInstances } from '../components/terminal/terminalRegistry';
import { openPullRequestInPanel } from '../services/githubTaskActions';
import { openLinearIssueInPanel } from '../services/linearTaskActions';
import { useAppStore } from '../stores/appStore';
import { useGithubStore } from '../stores/githubStore';
import { usePanelStore } from '../stores/panelStore';
import { stackMembers, stackOf, useTerminalStore } from '../stores/terminalStore';
import { useProjectStore } from '../stores/projectStore';
import { parseLink, type DiffSpot } from './ouijitLink';

const linkLog = log.scope('links');

/** The project a link names: by its name, which is its folder's. */
function projectPathOf(name: string): string | null {
  const { projects } = useAppStore.getState();
  const match = projects.find((p) => p.name === name) ?? projects.find((p) => p.path.split('/').pop() === name);
  return match?.path ?? null;
}

/** Beside the terminal, not over it: the reply holding the link often holds others. */
function showDiff(ptyId: string, diff: DiffSpot): void {
  const instance = terminalInstances.get(ptyId);
  instance?.setPanelFullWidth(false);
  instance?.revealInDiff(diff.path, diff.line ?? null);
}

/** A task's terminals, as clicking its row shows them; a task never started shows its card. */
export async function showTask(projectPath: string, taskNumber: number): Promise<string | null> {
  const unit = stackOf({ ptyId: '', projectPath, taskId: taskNumber });
  const task = (useAppStore.getState().taskCacheByProject[projectPath] ?? []).find((t) => t.taskNumber === taskNumber);
  const [front] = stackMembers(useTerminalStore.getState(), unit);
  if (front) {
    await focusTerminal(front, { stack: unit });
    return front;
  }
  if (task?.branch && task.worktreePath) {
    await openTaskTerminal(projectPath, task, undefined, unit);
    return stackMembers(useTerminalStore.getState(), unit)[0] ?? null;
  }
  await openProjectPage(projectPath, 'board');
  return null;
}

/**
 * Go where an `ouijit://` link says. It only navigates. Where the place has
 * gone — a terminal closed since — it lands on what held it.
 */
export async function openLink(uri: string): Promise<void> {
  const target = parseLink(uri);
  const projectPath = target && projectPathOf(target.project);
  if (!target || !projectPath) {
    linkLog.warn('unresolved link', { uri });
    useProjectStore.getState().addToast(target ? `No project named ${target.project}` : 'Not an Ouijit link', 'error');
    return;
  }
  switch (target.kind) {
    case 'project':
      await openProject(projectPath);
      return;
    case 'board':
      await openProjectPage(projectPath, 'board');
      return;
    case 'task': {
      const front = await showTask(projectPath, target.taskNumber);
      if (front && target.diff) showDiff(front, target.diff);
      return;
    }
    case 'terminal': {
      if (!(target.ptyId in useTerminalStore.getState().displayStates)) {
        await openProject(projectPath);
        return;
      }
      await focusTerminal(target.ptyId);
      if (target.diff) showDiff(target.ptyId, target.diff);
      else if (target.panelId) terminalInstances.get(target.ptyId)?.activatePanel(target.panelId);
      return;
    }
    case 'pr':
      openPullRequestInPanel(projectPath, target.number);
      return;
    case 'issue':
      if (!/^\d+$/.test(target.id)) {
        openLinearIssueInPanel(projectPath, target.id);
        return;
      }
      useAppStore.getState().openPage(projectPath, 'pull-requests');
      usePanelStore.getState().setProject(projectPath);
      useGithubStore.getState().setProject(projectPath);
      void useGithubStore.getState().openIssue(projectPath, Number(target.id));
      return;
  }
}
