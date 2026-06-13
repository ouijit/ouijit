/**
 * Session IPC handlers (task #462) — wires the renderer→main session channels
 * from {@link SessionInvokeContract} onto the {@link SessionManager} singleton.
 *
 * Only the read/attach surface is exposed here (list / get / attach / detach /
 * reattach), matching the contract. Spawn / write / resize / kill still flow
 * through the legacy `pty:*` channels until the renderer port (#461) and
 * projection (#463) move them over.
 */
import { typedHandle } from '../helpers';
import { getSessionManager } from '../../sessions';

export function registerSessionHandlers(): void {
  typedHandle('session:list', () => getSessionManager()?.list() ?? []);

  typedHandle('session:get', (id) => getSessionManager()?.get(id) ?? null);

  typedHandle('session:attach', (id) => getSessionManager()?.attach(id) ?? null);

  typedHandle('session:detach', (id) => {
    getSessionManager()?.detach(id);
  });

  typedHandle('session:reattach', async (id) => {
    const manager = getSessionManager();
    if (!manager) return null;
    return manager.reattach(id);
  });
}
