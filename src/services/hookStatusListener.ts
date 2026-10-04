import { terminalInstances } from '../components/terminal/terminalRegistry';

/**
 * Route agent hook status (claude / codex / pi / opencode) to the terminal it
 * names.
 *
 * Install once for the life of the renderer: a push arriving while the
 * installing component is unmounted is gone, and no view is mounted for the
 * whole time the app is open.
 *
 * Dispatch is synchronous. `handleHookStatus` counts the thinking events it
 * sees and reads differently on the second one, so it needs them in the order
 * they arrived — waiting for a terminal that is still reconnecting would let a
 * later status overtake an earlier one and leave the dot on the wrong state.
 * A status pushed during that window is lost instead, and `reconnectTerminal`
 * seeds the session's status as it comes back.
 */
export function installHookStatusListener(): () => void {
  return window.api.agentHooks.onStatus((ptyId, status) => {
    terminalInstances.get(ptyId)?.handleHookStatus(status as 'thinking' | 'ready');
  });
}
