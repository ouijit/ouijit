import { focusTerminal, openProject, openProjectPage, openTaskTerminal } from '../navigation';
import { terminalInstances } from '../terminal/terminalRegistry';
import { openPullRequestInPanel } from '../../services/githubTaskActions';
import { openLinearIssueInPanel } from '../../services/linearTaskActions';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { usePanelStore } from '../../stores/panelStore';
import { usePointerStore, type Pointer } from '../../stores/pointerStore';
import { revealDiffLine } from './pointAnchors';
import { stackMembers, stackOf, useTerminalStore } from '../../stores/terminalStore';
import type { PointTarget } from '../../types';

async function go(target: PointTarget): Promise<void> {
  switch (target.kind) {
    case 'task': {
      // As clicking its row does, except that a task never started goes to its card: following never starts one.
      const unit = stackOf({ ptyId: '', projectPath: target.projectPath, taskId: target.taskNumber });
      const [front] = stackMembers(useTerminalStore.getState(), unit);
      const task = (useAppStore.getState().taskCacheByProject[target.projectPath] ?? []).find(
        (t) => t.taskNumber === target.taskNumber,
      );
      if (front) await focusTerminal(front, { stack: unit });
      else if (task?.branch && task.worktreePath) await openTaskTerminal(target.projectPath, task, undefined, unit);
      else await openProjectPage(target.projectPath, 'board');
      return;
    }
    case 'terminal':
      await focusTerminal(target.ptyId);
      return;
    case 'project':
      await openProject(target.projectPath);
      return;
    case 'board':
      await openProjectPage(target.projectPath, 'board');
      return;
    case 'pr':
      openPullRequestInPanel(target.projectPath, target.number);
      return;
    case 'issue':
      if (!/^\d+$/.test(target.id)) {
        openLinearIssueInPanel(target.projectPath, target.id);
        return;
      }
      useAppStore.getState().openPage(target.projectPath, 'pull-requests');
      usePanelStore.getState().setProject(target.projectPath);
      useGithubStore.getState().setProject(target.projectPath);
      void useGithubStore.getState().openIssue(target.projectPath, Number(target.id));
      return;
    case 'panel':
      await focusTerminal(target.ptyId);
      terminalInstances.get(target.ptyId)?.activatePanel(target.panelId);
      return;
    case 'diff':
      await focusTerminal(target.ptyId);
      terminalInstances.get(target.ptyId)?.setDiffPanelOpen(true);
      return;
  }
}

/**
 * Go where the pointer points, and drop it. A move waiting on the pointer
 * runs instead of going: its dialog opens over wherever the user is, and its
 * hook opens the terminal. An ask goes to its terminal and opens, and stays
 * until the user runs or declines it: following never runs it.
 */
export async function followPointer(pointer: Pointer): Promise<void> {
  if (pointer.ask) {
    await go(pointer.target);
    usePointerStore.getState().openAsk(pointer.from);
    return;
  }
  usePointerStore.getState().dismiss(pointer.from);
  if (pointer.then) {
    pointer.then();
    return;
  }
  await go(pointer.target);
  if (pointer.target.kind === 'diff' && pointer.target.line != null) {
    revealDiffLine(pointer.target.path, pointer.target.line);
  }
}
