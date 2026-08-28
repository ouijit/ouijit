import { whenTerminalReady } from '../components/terminal/terminalRegistry';
import { TERMINAL_READY_WAIT_MS } from '../types';

/**
 * Route agent hook status (claude / codex / pi / opencode) to the terminal it
 * names.
 *
 * Install once for the life of the renderer: a push arriving while the
 * installing component is unmounted is gone, and no view is mounted for the
 * whole time the app is open.
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
