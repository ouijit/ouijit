import { startRunner } from '../components/terminal/terminalActions';
import { terminalInstances } from '../components/terminal/terminalRegistry';
import { homePanelHost } from '../components/chat/homeChatPanels';
import { isHomeChat } from '../stores/homeChatStore';
import { bufferText } from '../components/terminal/terminalText';
import { useTerminalStore } from '../stores/terminalStore';
import type { AskAnswer, AskRun } from '../types';
import { ASK_OUTPUT_LINES, NO_PAGER, exitedAnswer } from '../askOutput';

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
        resolve(
          exitedAnswer({
            exitCode: panel.exitCode ?? null,
            output: child && !panel.private ? bufferText(child.xterm, ASK_OUTPUT_LINES) : '',
            privately: !!panel.private,
            panelId,
          }),
        );
      }
    };
    stop = useTerminalStore.subscribe(check);
    check();
  });
}

/**
 * Run an ask the user approved in a runner on the card that asked. The answer
 * is the panel at once, or with `wait` how the run ended.
 */
export async function runApprovedAsk(fromPtyId: string, ask: AskRun, privately: boolean): Promise<AskAnswer> {
  // One of Chat's conversations runs it beside itself, in its own folder.
  if (isHomeChat(fromPtyId)) await homePanelHost(fromPtyId);
  const panelId = await startRunner(
    fromPtyId,
    {
      name: ask.scriptName ?? ask.command,
      command: ask.runCommand ?? ask.command,
      env: NO_PAGER,
      private: privately,
    },
    'none',
  );
  if (!panelId) return { status: 'declined' };
  return ask.wait ? outcome(fromPtyId, panelId) : { status: 'pending', panelId };
}
