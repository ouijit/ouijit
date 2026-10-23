import { focusTerminal, openProject, openProjectPage } from '../navigation';
import { terminalInstances } from '../terminal/terminalRegistry';
import { openPullRequestInPanel } from '../../services/githubTaskActions';
import { openLinearIssueInPanel } from '../../services/linearTaskActions';
import { useAppStore } from '../../stores/appStore';
import { useGithubStore } from '../../stores/githubStore';
import { usePanelStore } from '../../stores/panelStore';
import { usePointerStore, type Pointer } from '../../stores/pointerStore';
import { anchorChain } from './pointKeys';
import { revealWhenShown } from './pointAnchors';
import { stackMembers, stackOf, useTerminalStore } from '../../stores/terminalStore';
import type { PointTarget } from '../../types';

async function go(target: PointTarget): Promise<void> {
  switch (target.kind) {
    case 'task': {
      // A task with nothing open goes to its card: following a pointer never starts or opens anything.
      const unit = stackOf({ ptyId: '', projectPath: target.projectPath, taskId: target.taskNumber });
      const [front] = stackMembers(useTerminalStore.getState(), unit);
      if (front) await focusTerminal(front, { stack: unit });
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

/** Go where the pointer points and drop it, then run whatever was waiting on it. */
export async function followPointer(pointer: Pointer): Promise<void> {
  usePointerStore.getState().dismiss(pointer.from);
  await go(pointer.target);
  const [own] = anchorChain(pointer.target, {
    displays: useTerminalStore.getState().displayStates,
    tasksByProject: useAppStore.getState().taskCacheByProject,
  });
  revealWhenShown(own);
  pointer.then?.();
}
