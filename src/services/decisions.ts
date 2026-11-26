import { useWaitingStore } from '../stores/waitingStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useAppStore } from '../stores/appStore';
import { isHomeChat } from '../stores/homeChatStore';
import { notifyUnfocused } from '../utils/notifications';
import { askVerb, type Decision, type DecisionChoice } from '../types';

/** Each decision the main process holds, by the waiting item that shows it. */
const shown = new Map<string, number>();

function decide(id: string, choice: DecisionChoice): void {
  void window.api.decisions.decide(id, choice);
}

function notify(decision: Decision): void {
  const display = useTerminalStore.getState().displayStates[decision.from];
  if (!display) return;
  const project = useAppStore.getState().projects.find((p) => p.path === display.projectPath);
  notifyUnfocused(
    project?.name ?? 'Ouijit',
    `${display.label} asks to ${decision.ask.shell ? 'open a shell' : `${askVerb(decision.ask).toLowerCase()} ${decision.ask.command}`}`,
  );
}

/**
 * Asks wait in the main process; the queue shows them, and answers them there.
 * One decided elsewhere leaves the queue.
 */
function show(decisions: Decision[], arriving: boolean): void {
  const store = useWaitingStore.getState();
  const live = new Set(decisions.map((d) => d.id));
  for (const [decisionId, waitingId] of shown) {
    if (live.has(decisionId)) continue;
    shown.delete(decisionId);
    store.remove(waitingId);
  }
  for (const decision of decisions) {
    if (shown.has(decision.id)) continue;
    const decline = () => decide(decision.id, { kind: 'decline' });
    const run = (privately = false) => decide(decision.id, { kind: 'run', privately });
    shown.set(
      decision.id,
      store.add({
        kind: 'ask',
        from: decision.from,
        ask: {
          ...decision.ask,
          ...(decision.message && { message: decision.message }),
          ...(decision.sandboxed && { outsideSandbox: true }),
          run,
          decline,
        },
      }),
    );
    if (arriving && !isHomeChat(decision.from)) notify(decision);
  }
}

/** Install once for the life of the renderer. */
export function listenForDecisions(): () => void {
  let pushed = false;
  const stop = window.api.decisions.onChange((decisions) => {
    pushed = true;
    show(decisions, true);
  });
  void window.api.decisions.list().then((decisions) => pushed || show(decisions, false));
  return stop;
}
