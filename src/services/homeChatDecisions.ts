import { completeTask } from './taskCompletion';
import { presentWaiting } from './presentWaiting';
import { loadTasks } from '../stores/projectDataStore';
import { useProjectStore } from '../stores/projectStore';
import { useWaitingStore } from '../stores/waitingStore';
import type { HomeChatConfirm } from '../chat/preferences';
import type { AskAnswer, AskRun, CliAskResponse } from '../types';

/** Chat hears how the user decided whatever it was waiting on. */
function tell(text: string): void {
  void window.api.homeChat.wake(null, text);
}

/** A done or a trash from Chat, held until the user confirms it. */
export function holdHomeChatConfirm(request: HomeChatConfirm): void {
  const { projectPath, taskNumber, action } = request;
  const what = action === 'done' ? 'moving' : 'trashing';
  const id = useWaitingStore.getState().add({
    kind: 'confirm',
    from: request.from,
    projectPath,
    taskNumber,
    action,
    run: () => {
      void (async () => {
        const task = await window.api.task.getByNumber(projectPath, taskNumber);
        if (!task) return;
        if (action === 'done') {
          await completeTask({ projectPath, task });
          tell(`the user confirmed moving T-${taskNumber} to done.`);
        } else {
          await window.api.task.trash(projectPath, taskNumber);
          loadTasks(projectPath);
          useProjectStore.getState().addToast('Task moved to trash', 'success');
          tell(`the user confirmed trashing T-${taskNumber}.`);
        }
      })();
    },
    cancel: () => tell(`the user cancelled ${what} T-${taskNumber}${action === 'done' ? ' to done' : ''}.`),
  });
  presentWaiting(id, request.from);
}

/**
 * An ask from Chat itself. Chat has no card to hold a runner, so an approved
 * run happens in the main process and its output comes back here, to show in
 * Chat and to answer the ask with.
 */
export function askFromHomeChat(from: string, ask: AskRun, message: string | undefined): Promise<CliAskResponse> {
  return new Promise((resolve) => {
    const answer = (a: AskAnswer) => resolve({ ok: true, answer: a });
    let decided = false;
    const id = useWaitingStore.getState().add({
      kind: 'ask',
      from,
      ask: {
        ...ask,
        ...(message && { message }),
        run: (privately = false) => {
          if (decided) return;
          decided = true;
          useWaitingStore.getState().remove(id);
          void window.api.homeChat.runAsk(ask.runCommand ?? ask.command, ask.cwd).then(({ exitCode, output }) => {
            const ended = { status: 'exited' as const, panelId: '', exitCode };
            answer(privately ? { ...ended, private: true } : { ...ended, output });
            if (!ask.wait) {
              tell(
                privately
                  ? `the user ran \`${ask.command}\` privately; it exited with ${exitCode}.`
                  : `the user ran \`${ask.command}\`; it exited with ${exitCode}.\n\n${output}`,
              );
            }
          });
        },
        decline: () => {
          if (decided) return;
          decided = true;
          answer({ status: 'declined' });
          if (!ask.wait) tell(`the user declined to run \`${ask.command}\`.`);
        },
      },
    });
    presentWaiting(id, from);
    if (!ask.wait) answer({ status: 'pending' });
  });
}
