import { startRunner } from '../components/terminal/terminalActions';
import { terminalInstances } from '../components/terminal/terminalRegistry';
import { bufferText } from '../components/terminal/terminalText';
import { useAppStore } from '../stores/appStore';
import { usePointerStore } from '../stores/pointerStore';
import { stackMembers, useTerminalStore } from '../stores/terminalStore';
import type { AskAnswer, AskRun, CliPointResponse } from '../types';

const OUTPUT_LINES = 100;

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

function onScreen(ptyId: string): boolean {
  const { selection } = useAppStore.getState();
  return selection.kind === 'terminal' && stackMembers(useTerminalStore.getState(), selection.stack).includes(ptyId);
}

/**
 * Put `ouijit ask run` in front of the user as the asking terminal's pointer,
 * opened at once when that terminal's task is the one on screen: a pointer
 * there would point at what the user is already looking at. Closed, it stays
 * as the pointer.
 * Approved, it runs on the host in a runner panel on that terminal. The reply
 * comes at once, or with `wait` once the user declines or the run ends.
 */
export function askToRun(fromPtyId: string, ask: AskRun, message: string | undefined): Promise<CliPointResponse> {
  if (!(fromPtyId in useTerminalStore.getState().displayStates)) {
    return Promise.resolve({ ok: false, error: `No terminal ${fromPtyId}` });
  }
  return new Promise((resolve) => {
    const answer = (a: AskAnswer) => resolve({ ok: true, answer: a });
    let decided = false;
    usePointerStore.getState().point({
      from: fromPtyId,
      target: { kind: 'terminal', ptyId: fromPtyId },
      ...(message && { message }),
      ask: {
        ...ask,
        run: () => {
          if (decided) return;
          decided = true;
          void startRunner(fromPtyId, { name: ask.scriptName ?? ask.command, command: ask.command }).then(
            async (panelId) => {
              if (!panelId) answer({ status: 'declined' });
              else answer(ask.wait ? await outcome(fromPtyId, panelId) : { status: 'pending', panelId });
            },
          );
        },
        decline: () => {
          if (decided) return;
          decided = true;
          answer({ status: 'declined' });
        },
      },
    });
    const pointers = usePointerStore.getState();
    if (onScreen(fromPtyId) && (pointers.asking == null || pointers.asking === fromPtyId)) pointers.openAsk(fromPtyId);
    if (!ask.wait) answer({ status: 'pending' });
  });
}
