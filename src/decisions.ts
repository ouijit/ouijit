import { randomUUID } from 'node:crypto';
import type { Decision, DecisionChoice } from './ask';

interface Held {
  decision: Decision;
  /** `quiet` when nobody is left to tell: whatever asked is gone. */
  settle: (choice: DecisionChoice, quiet: boolean) => Promise<void>;
}

const held = new Map<string, Held>();
const listeners = new Set<(decisions: Decision[]) => void>();

export function decisions(): Decision[] {
  return [...held.values()].map((h) => h.decision);
}

export function onDecisionsChange(listener: (decisions: Decision[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  const all = decisions();
  for (const listener of listeners) listener(all);
}

export function hold(decision: Omit<Decision, 'id' | 'at'>, settle: Held['settle']): string {
  const id = randomUUID();
  held.set(id, { decision: { ...decision, id, at: Date.now() }, settle });
  changed();
  return id;
}

export function isHeld(id: string): boolean {
  return held.has(id);
}

/** Decided once. False when it was already decided, here or in another window. */
export async function decide(id: string, choice: DecisionChoice, quiet = false): Promise<boolean> {
  const entry = held.get(id);
  if (!entry) return false;
  held.delete(id);
  changed();
  await entry.settle(choice, quiet);
  return true;
}

/** What asked is gone, so what it waits on goes with it, declined. */
export async function dropDecisionsFrom(from: string): Promise<void> {
  const ids = [...held.entries()].filter(([, h]) => h.decision.from === from).map(([id]) => id);
  for (const id of ids) await decide(id, { kind: 'decline' }, true);
}
