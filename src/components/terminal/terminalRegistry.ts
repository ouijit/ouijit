/**
 * Where live terminals are looked up by PTY id.
 *
 * Deliberately free of runtime imports (the `OuijitTerminal` import is
 * type-only) so anything can reach a terminal without pulling in xterm.
 */
import type { OuijitTerminal } from './terminalReact';

export const terminalInstances = new Map<string, OuijitTerminal>();

const registrationWaiters = new Map<string, Set<(instance: OuijitTerminal) => void>>();

/**
 * Restores currently in flight, keyed by PTY id. A terminal enters
 * `terminalInstances` partway through its restore, so this is what separates a
 * session that is absent from one that is on its way back.
 */
const restoresInFlight = new Map<string, Promise<unknown>>();

/**
 * Register a live terminal under `ptyId`. Registration is the moment anything
 * outside the terminal can reach it, and the only place waiters are released,
 * so it goes through here rather than a bare `terminalInstances.set`.
 */
export function registerTerminalInstance(ptyId: string, instance: OuijitTerminal): void {
  terminalInstances.set(ptyId, instance);
  const waiters = registrationWaiters.get(ptyId);
  if (!waiters) return;
  registrationWaiters.delete(ptyId);
  for (const release of waiters) release(instance);
}

/** Drop `ptyId`'s registration — the terminal is disposed or re-keyed. */
export function unregisterTerminalInstance(ptyId: string): void {
  terminalInstances.delete(ptyId);
}

export function restoreInFlight(ptyId: string): Promise<unknown> | undefined {
  return restoresInFlight.get(ptyId);
}

/** Publish `restore` as the in-flight restore for `ptyId` until it settles. */
export function trackRestore<T>(ptyId: string, restore: Promise<T>): Promise<T> {
  restoresInFlight.set(ptyId, restore);
  const clear = (): void => {
    if (restoresInFlight.get(ptyId) === restore) restoresInFlight.delete(ptyId);
  };
  restore.then(clear, clear);
  return restore;
}

function whenRegistered(ptyId: string, timeoutMs: number): Promise<OuijitTerminal | null> {
  const existing = terminalInstances.get(ptyId);
  if (existing) return Promise.resolve(existing);

  const waiters = registrationWaiters.get(ptyId) ?? new Set<(instance: OuijitTerminal) => void>();
  registrationWaiters.set(ptyId, waiters);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(release);
      if (waiters.size === 0) registrationWaiters.delete(ptyId);
      resolve(null);
    }, timeoutMs);

    const release = (instance: OuijitTerminal): void => {
      clearTimeout(timer);
      resolve(instance);
    };
    waiters.add(release);
  });
}

/**
 * The terminal for `ptyId`, ready to take changes, waiting up to `timeoutMs`
 * for one. Resolves with null if none arrives.
 *
 * Registration alone is not enough: a reconnecting terminal registers at `bind`
 * and only then restores its snapshot, and that restore replaces `panels`
 * wholesale — so a panel added in between is silently dropped. Waiting out the
 * in-flight restore too is what makes a change that lands mid renderer-reload
 * take effect instead of disappearing.
 */
export async function whenTerminalReady(ptyId: string, timeoutMs: number): Promise<OuijitTerminal | null> {
  const deadline = Date.now() + timeoutMs;
  if (!(await whenRegistered(ptyId, timeoutMs))) return null;

  const restore = restoresInFlight.get(ptyId);
  if (restore) {
    await Promise.race([
      restore.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
    ]);
  }
  return terminalInstances.get(ptyId) ?? null;
}
