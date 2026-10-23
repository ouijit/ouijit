import { focusTerminal, openProject, openProjectPage, openTaskTerminal } from '../navigation';
import { terminalInstances } from '../terminal/terminalRegistry';
import { openPullRequestInPanel } from '../../services/githubTaskActions';
import { openLinearIssueInPanel } from '../../services/linearTaskActions';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { usePanelStore } from '../../stores/panelStore';
import { usePointerStore, type Pointer } from '../../stores/pointerStore';
import { anchorChain } from './pointKeys';
import { findAnchor, revealWhenShown } from './pointAnchors';
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
 * Go where the pointer points. A pointer whose ribbon is on its target is
 * done with and goes; one standing in on what holds the target stays, so the
 * ribbon lands on the line or card it meant once that is on screen. A move
 * waiting on the pointer runs instead of going: its dialog opens over wherever
 * the user is, and its hook opens the terminal.
 */
export async function followPointer(followed: Pointer): Promise<void> {
  const pointer = usePointerStore.getState().pointers.find((p) => p.from === followed.from) ?? followed;
  const chain = anchorChain(pointer.target, {
    displays: useTerminalStore.getState().displayStates,
    tasksByProject: useAppStore.getState().taskCacheByProject,
  });
  const done = pointer.then || pointer.followed || findAnchor(chain)?.depth === 0;
  if (done) usePointerStore.getState().dismiss(pointer.from);
  else usePointerStore.getState().markFollowed(pointer.from);
  if (pointer.then) {
    pointer.then();
    return;
  }
  await go(pointer.target);
  revealWhenShown(chain[0]);
}
