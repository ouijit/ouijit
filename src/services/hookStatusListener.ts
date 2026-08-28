import { whenTerminalReady } from '../components/terminal/terminalRegistry';
import { TERMINAL_READY_WAIT_MS } from '../types';

/**
 * Route agent hook status (claude / codex / pi / opencode) to the terminal it
 * names.
 *
 * Installed once for the life of the renderer. Mounting this from a view
 * instead drops every push arriving while that view is unmounted — opening
 * global settings replaces the home view, and a terminal that finished then
 * kept a stale thinking dot.
 *
 * A terminal's opening status comes from `reconnectTerminal`, which reads it
 * as the session reconnects; this listener only carries the changes after.
 */
export function installHookStatusListener(): () => void {
  return window.api.agentHooks.onStatus((ptyId, status) => {
    void whenTerminalReady(ptyId, TERMINAL_READY_WAIT_MS).then((instance) =>
      instance?.handleHookStatus(status as 'thinking' | 'ready'),
    );
  });
}
