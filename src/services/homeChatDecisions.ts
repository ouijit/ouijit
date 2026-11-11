import { presentWaiting } from './presentWaiting';
import { useWaitingStore } from '../stores/waitingStore';
import type { ChatDecision } from '../chat/preferences';

/** Each decision the main process holds, by the waiting item that shows it. */
const shown = new Map<string, number>();

function decide(id: string, choice: Parameters<typeof window.api.homeChat.decide>[1]): void {
  void window.api.homeChat.decide(id, choice);
}

/**
 * Chat's decisions live in the main process; the queue shows them as it shows
 * a terminal's, and answers them there. One decided elsewhere leaves the queue.
 */
function show(decisions: ChatDecision[]): void {
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
    const waitingId =
      decision.kind === 'ask'
        ? store.add({
            kind: 'ask',
            from: decision.from,
            ask: { ...decision.ask, ...(decision.message && { message: decision.message }), run, decline },
          })
        : store.add({
            kind: 'confirm',
            from: decision.from,
            projectPath: decision.projectPath,
            taskNumber: decision.taskNumber,
            action: decision.action,
            run: () => run(),
            cancel: decline,
          });
    shown.set(decision.id, waitingId);
    presentWaiting(waitingId, decision.from);
  }
}

let listening = false;

export function listenForChatDecisions(): void {
  if (listening) return;
  listening = true;
  window.api.homeChat.onDecisions(show);
  void window.api.homeChat.decisions().then(show);
}
