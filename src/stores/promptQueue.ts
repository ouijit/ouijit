/**
 * Prompts a service raises and a dialog answers, queued so that concurrent
 * requests are presented one at a time rather than the newest evicting the
 * prior one.
 *
 * The promise `queuePrompt` returns settles only when something calls back
 * with the matching id, so a queue whose dialog is not mounted hangs every
 * caller awaiting it, and dropping a queue without settling it hangs them for
 * good — clear one with `settleAllPrompts` rather than by assigning `[]`.
 */

export interface Pending<Answer> {
  id: number;
  resolve: (answer: Answer) => void;
}

let counter = 0;

/** Append a prompt to a store-held queue. Resolves when it is settled by id. */
export function queuePrompt<Req, Answer>(req: Req, append: (entry: Req & Pending<Answer>) => void): Promise<Answer> {
  return new Promise<Answer>((resolve) => append({ ...req, id: ++counter, resolve }));
}

/** Settle one prompt, returning the queue without it — or null if the id is gone. */
export function settlePrompt<Answer, T extends Pending<Answer>>(queue: T[], id: number, answer: Answer): T[] | null {
  const target = queue.find((entry) => entry.id === id);
  if (!target) return null;
  const next = queue.filter((entry) => entry.id !== id);
  target.resolve(answer);
  return next;
}

/** Settle every queued prompt, returning the empty queue. */
export function settleAllPrompts<Answer, T extends Pending<Answer>>(
  queue: T[],
  answerFor: (entry: T, index: number) => Answer,
): T[] {
  queue.forEach((entry, index) => entry.resolve(answerFor(entry, index)));
  return [];
}
