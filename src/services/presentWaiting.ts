import { useAppStore } from '../stores/appStore';
import { getActivePtyId } from '../stores/terminalStore';
import { useWaitingStore } from '../stores/waitingStore';

/**
 * Opens the dialog on what was just left for the user when it came from the
 * terminal they are looking at. Anything else waits behind the title bar's
 * count, and one arriving while the dialog is open joins its list.
 */
export function presentWaiting(id: number, fromPtyId: string): void {
  const { selection } = useAppStore.getState();
  const inFront = selection.kind === 'terminal' && getActivePtyId(selection.stack) === fromPtyId;
  const waiting = useWaitingStore.getState();
  if (inFront && !waiting.open) waiting.show(id);
}
