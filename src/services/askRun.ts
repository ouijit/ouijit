import { startRunner } from '../components/terminal/terminalActions';
import { terminalInstances } from '../components/terminal/terminalRegistry';
import { bufferText } from '../components/terminal/terminalText';
import { useAppStore } from '../stores/appStore';
import { notifyUnfocused } from '../utils/notifications';
import { useWaitingStore } from '../stores/waitingStore';
import { getActivePtyId, useTerminalStore } from '../stores/terminalStore';
import type { AskAnswer, AskRun, CliAskResponse } from '../types';

const OUTPUT_LINES = 100;

/**
 * The run is a real terminal, so `gh api` or `git log` would open a pager and
 * wait for a keypress nobody is there to give. An editor still waits: that one
 * the user can answer in the panel, and turning it off would change the command.
 */
const NO_PAGER = { PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' };

/** Resolves once the runner's command has finished, or its panel has closed. */
function outcome(ptyId: string, panelId: string): Promise<AskAnswer> {
  return new Promise((resolve) => {
    let stop = () => {};
    const check = () => {
      const panel = useTerminalStore.getState().displayStates[ptyId]?.panels.find((p) => p.id === panelId);
      if (panel?.kind !== 'runner') {
        stop();
        resolve({ status: 'closed', panelId });
      } else if (panel.status === 'success' || panel.status === 'error') {
        stop();
        const child = terminalInstances.get(ptyId)?.runnerChildren.get(panelId);
        resolve({
          status: 'exited',
          panelId,
          exitCode: panel.exitCode ?? null,
          output: child ? bufferText(child.xterm, OUTPUT_LINES) : '',
        });
      }
    };
    stop = useTerminalStore.subscribe(check);
    check();
  });
}

function inFront(ptyId: string): boolean {
  const { selection } = useAppStore.getState();
  return selection.kind === 'terminal' && getActivePtyId(selection.stack) === ptyId;
}

/**
 * Put `ouijit ask run` in the queue, opened at once when the asking terminal is
 * the one in front and nothing else of the queue's is open. Closed, it stays in the queue.
 * Approved, it runs on the host in a runner panel on that terminal, and stays
 * in the queue until the run ends: one that fails stays on, marked. The reply
 * comes at once, or with `wait` once the user declines or the run ends.
 */
export function askToRun(fromPtyId: string, ask: AskRun, message: string | undefined): Promise<CliAskResponse> {
  if (!(fromPtyId in useTerminalStore.getState().displayStates)) {
    return Promise.resolve({ ok: false, error: `No terminal ${fromPtyId}` });
  }
  return new Promise((resolve) => {
    const answer = (a: AskAnswer) => resolve({ ok: true, answer: a });
    let decided = false;
    const id = useWaitingStore.getState().add({
      kind: 'ask',
      from: fromPtyId,
      ask: {
        ...ask,
        ...(message && { message }),
        run: () => {
          if (decided) return;
          decided = true;
          void startRunner(fromPtyId, {
            name: ask.scriptName ?? ask.command,
            command: ask.runCommand ?? ask.command,
            env: NO_PAGER,
          }).then(async (panelId) => {
            const queue = useWaitingStore.getState();
            if (!panelId) {
              queue.remove(id);
              answer({ status: 'declined' });
              return;
            }
            queue.ran(id, { status: 'running', panelId });
            if (!ask.wait) answer({ status: 'pending', panelId });
            const result = await outcome(fromPtyId, panelId);
            answer(result);
            // A failed run stays, for the user to see; one that succeeded, or whose runner closed, is done.
            if (result.status === 'exited' && result.exitCode !== 0) {
              useWaitingStore.getState().ran(id, { status: 'failed', panelId, exitCode: result.exitCode });
            } else {
              useWaitingStore.getState().remove(id);
            }
          });
        },
        decline: () => {
          if (decided) return;
          decided = true;
          answer({ status: 'declined' });
        },
      },
    });
    const waiting = useWaitingStore.getState();
    if (inFront(fromPtyId) && waiting.open == null && !waiting.listOpen) waiting.openAsk(id);
    const display = useTerminalStore.getState().displayStates[fromPtyId];
    const project = useAppStore.getState().projects.find((p) => p.path === display.projectPath);
    notifyUnfocused(project?.name ?? 'Ouijit', `${display.label} asks to run ${ask.command}`);
    if (!ask.wait) answer({ status: 'pending' });
  });
}
