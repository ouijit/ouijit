import { describe, test, expect } from 'vitest';
import { Mailbox } from '../chat/mailbox';

describe("what Chat is told while it can't take it", () => {
  test('arrives at once when it is free, together once it is free again, and not at all once it is gone', async () => {
    const sent: [string, string][] = [];
    const captions: string[][] = [];
    const note = (text: string) => ({ kind: 'event' as const, text });
    const ready = new Set(['a']);
    const exists = new Set(['a', 'b']);
    let release = () => {};
    const mailbox = new Mailbox({
      exists: (id) => exists.has(id),
      ready: (id) => ready.has(id),
      send: (id, text, notes) => {
        sent.push([id, text]);
        captions.push(notes.map((n) => n.text));
        // Sending starts a turn: busy until the test ends it.
        ready.delete(id);
        return new Promise<void>((resolve) => (release = resolve));
      },
    });

    const first = mailbox.post('a', 'T-1 finished its turn.', note('T-1 finished its turn.'));
    // Arrives while the first is still going out, and while the turn it starts runs.
    await mailbox.post('a', 'T-2 is waiting on an approval.', note('T-2 is waiting on an approval.'));
    await mailbox.post('a', 'T-3 moved to In review.', note('T-3 moved to In review.'));
    release();
    await first;
    expect(sent).toEqual([['a', 'Ouijit: T-1 finished its turn.']]);

    ready.add('a');
    const second = mailbox.deliver('a');
    release();
    await second;
    // Each message keeps its own line for the person reading.
    expect(captions[1]).toEqual(['T-2 is waiting on an approval.', 'T-3 moved to In review.']);
    expect(sent[1]).toEqual([
      'a',
      'Ouijit: while you were busy or away:\n- T-2 is waiting on an approval.\n- T-3 moved to In review.',
    ]);

    // A conversation that is not running keeps what it is sent, up to a point.
    for (let i = 1; i <= 52; i++) await mailbox.post('b', `event ${i}`, note(`event ${i}`));
    ready.add('b');
    const third = mailbox.deliver('b');
    release();
    await third;
    const [to, text] = sent[2];
    expect(to).toBe('b');
    expect(text.split('\n').slice(1, 2)).toEqual(['- event 3']);
    expect(text.endsWith('- event 52\n- and 2 earlier, no longer kept')).toBe(true);

    // Deleted, what was held for it goes with it.
    await mailbox.post('b', 'late news', note('late news'));
    exists.delete('b');
    await mailbox.deliver('b');
    exists.add('b');
    ready.add('b');
    await mailbox.deliver('b');
    expect(sent).toHaveLength(3);
  });
});
