import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { DiffNotesIsland } from '../../components/diff/DiffNotesIsland';
import type { DiffNote } from '../../diffNotes';

const PTY = 'pty-1';
const SUBJECT = 'the uncommitted changes';

const NOTES: DiffNote[] = [
  {
    id: 'n1',
    worktreePath: '/w',
    path: 'src/a.ts',
    line: 14,
    startLine: 12,
    side: 'RIGHT',
    snippet: '  const x = doThing()\n  return x',
    body: 'this can throw',
    createdAt: '2026-08-10T00:00:00.000Z',
  },
  {
    id: 'n2',
    worktreePath: '/w',
    path: 'src/b.ts',
    line: 40,
    startLine: 40,
    side: 'LEFT',
    snippet: 'old()',
    body: 'why did this go?',
    createdAt: '2026-08-10T00:01:00.000Z',
  },
];

function renderMenu(notes = NOTES, inView = new Set(notes.map((n) => n.id))) {
  const onJump = vi.fn();
  const onDiscard = vi.fn().mockResolvedValue(undefined);
  const onClear = vi.fn().mockResolvedValue(undefined);
  render(
    <DiffNotesIsland
      notes={notes}
      inView={inView}
      subject={SUBJECT}
      ptyId={PTY}
      onJump={onJump}
      onDiscard={onDiscard}
      onClear={onClear}
    />,
  );
  return { onJump, onDiscard, onClear };
}

let written: string[] = [];

describe('handing diff notes to the agent', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    written = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockImplementation((t: string) => (written.push(t), Promise.resolve())) },
    });
  });

  test('is not there until something has been written', () => {
    const { container } = render(
      <DiffNotesIsland
        notes={[]}
        inView={new Set()}
        subject={SUBJECT}
        ptyId={PTY}
        onJump={vi.fn()}
        onDiscard={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('counts what is waiting', () => {
    renderMenu();
    expect(screen.getByText('2 notes')).toBeTruthy();
    cleanup();
    renderMenu([NOTES[0]]);
    expect(screen.getByText('1 note')).toBeTruthy();
  });

  test('hands over the code each note is about, not just where it was', async () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('Copy'));

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toContain(`2 notes on ${SUBJECT}.`);
    expect(written[0]).toContain('src/a.ts:12-14');
    expect(written[0]).toContain('> const x = doThing()\n> return x');
    expect(written[0]).toContain('this can throw');
    // A note about code that has gone says so, or its numbers read as lines
    // that could be looked up.
    expect(written[0]).toContain('src/b.ts:40 (removed)');
  });

  test('pastes into the terminal as a paste, not as typing', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('Send'));

    const write = vi.mocked(window.api.pty.write);
    expect(write).toHaveBeenCalledTimes(1);
    const [ptyId, data] = write.mock.calls[0];
    expect(ptyId).toBe(PTY);
    // Bracketed paste, or every newline in a note is the Enter key — and no
    // trailing newline, so what is sent stays the reader's decision.
    expect(data.startsWith('\x1b[200~')).toBe(true);
    expect(data.endsWith('\x1b[201~')).toBe(true);
    expect(data).not.toContain('\n\x1b[201~');
  });

  test('a note in the list jumps to the file it is on', () => {
    const { onJump } = renderMenu();
    fireEvent.click(screen.getByText('2 notes'));
    fireEvent.click(screen.getByText('this can throw'));
    expect(onJump).toHaveBeenCalledWith(NOTES[0]);
  });

  test('a note the comparison on screen cannot show is listed, said so, and does not pretend to jump', async () => {
    const { onJump } = renderMenu(NOTES, new Set(['n2']));
    fireEvent.click(screen.getByText('2 notes'));

    expect(screen.getByText('not in this comparison')).toBeTruthy();
    fireEvent.click(screen.getByText('this can throw'));
    expect(onJump).not.toHaveBeenCalled();

    // Listed all the same, so it is still there to discard — and it goes to
    // the agent either way.
    fireEvent.click(screen.getByLabelText('Copy'));
    await waitFor(() => expect(written[0]).toContain('this can throw'));
  });

  test('discarding is per note, and all at once', () => {
    const { onDiscard, onClear } = renderMenu();
    fireEvent.click(screen.getByText('2 notes'));
    fireEvent.click(screen.getAllByTitle('Discard this note')[1]);
    expect(onDiscard).toHaveBeenCalledWith('n2');

    fireEvent.click(screen.getByText('Discard all'));
    expect(onClear).toHaveBeenCalled();
  });
});
