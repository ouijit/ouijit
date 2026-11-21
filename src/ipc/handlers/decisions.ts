import { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { decide, decisions, dropDecisionsFrom, onDecisionsChange } from '../../decisions';
import { chatHost } from '../../chat/host';

export function registerDecisionHandlers(mainWindow: BrowserWindow): void {
  onDecisionsChange((all) => typedPush(mainWindow, 'decisions:changed', all));
  typedHandle('decisions:list', () => decisions());
  typedHandle('decisions:decide', (id, choice) => decide(id, choice));
  // Chat's own asks outlive a restart of its agent: an outcome is told to the conversation.
  chatHost.subscribe((id, { event }) => {
    if (event.type === 'session' && event.patch.status === 'exited' && chatHost.roleOf(id) !== 'home') {
      void dropDecisionsFrom(id);
    }
  });
}
