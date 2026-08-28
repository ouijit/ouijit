/**
 * Where live terminals are looked up by PTY id.
 *
 * Deliberately free of runtime imports (the `OuijitTerminal` import is
 * type-only) so anything can reach a terminal without pulling in xterm.
 */
import type { OuijitTerminal } from './terminalReact';

export const terminalInstances = new Map<string, OuijitTerminal>();

const restoresInFlight = new Map<string, Promise<unknown>>();

const POLL_MS = 50;

/**
 * Restore `ptyId` at most once across concurrent callers. A caller that loses
 * the race awaits the winner rather than skipping ahead, so the terminal list
 * is final by the time it returns.
 */
export async function restoreTerminalOnce(ptyId: string, restore: () => Promise<unknown>): Promise<void> {
  if (terminalInstances.has(ptyId)) return;

  const inFlight = restoresInFlight.get(ptyId);
  if (inFlight) {
    // The winner reports its own failure; the loser only needs it to be over.
    await inFlight.catch(() => {});
    return;
  }

  const pending = restore();
  restoresInFlight.set(ptyId, pending);
  try {
    await pending;
  } finally {
    restoresInFlight.delete(ptyId);
  }
}

/**
 * The terminal for `ptyId` once it can take changes, waiting up to `timeoutMs`.
 * Resolves with null if none arrives.
 *
 * Being in `terminalInstances` is not enough: a reconnecting terminal lands
 * there at `bind` and only then restores its snapshot, and that restore
 * replaces `panels` wholesale — so a panel added in between is silently
 * dropped. Both conditions have to hold for a change that arrives mid
 * renderer-reload to survive.
 */
export async function whenTerminalReady(ptyId: string, timeoutMs: number): Promise<OuijitTerminal | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const instance = terminalInstances.get(ptyId);
    if (instance && !restoresInFlight.has(ptyId)) return instance;
    if (Date.now() >= deadline) return instance ?? null;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
