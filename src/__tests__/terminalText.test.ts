import { describe, test, expect } from 'vitest';
import { Terminal } from '@xterm/headless';
import { bufferText, pasteable } from '../components/terminal/terminalText';

function terminal(cols: number): Terminal {
  return new Terminal({ cols, rows: 6, allowProposedApi: true });
}

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe('reading a terminal', () => {
  test('gives the lines as they read on screen, wrapped rows joined and the blank rows below dropped', async () => {
    const term = terminal(20);
    await write(term, 'npm test\r\n');
    await write(term, `${'x'.repeat(19)} wrapped at a space\r\n`);
    await write(term, '3 failing\r\n\r\n');

    expect(bufferText(term, 100)).toBe(['npm test', `${'x'.repeat(19)} wrapped at a space`, '3 failing'].join('\n'));
    expect(bufferText(term, 1)).toBe('3 failing');

    // zsh pads the row with spaces to place its `%` marker; output written over it keeps none of them.
    await write(term, `%${' '.repeat(19)}\rORIGINAL SCRIPT\r\n`);
    expect(bufferText(term, 1)).toBe('ORIGINAL SCRIPT');

    // A full-screen program draws on the alternate screen; that is what's on screen.
    await write(term, '\x1b[?1049h\x1b[H> prompt');
    expect(term.buffer.active.type).toBe('alternate');
    expect(bufferText(term, 100)).toBe('> prompt');
  });
});

describe('pasting into a terminal', () => {
  test("keeps the text but nothing that could end the paste early or press a key, and won't send lines where newlines are Enter", () => {
    const sneaky = 'fix the test\x1b[201~\rrm -rf ~\x03\tok';
    expect(pasteable(sneaky, true)).toBe('fix the test[201~\nrm -rf ~\tok');
    expect(pasteable(sneaky, false)).toEqual({ error: expect.stringMatching(/one line/) });

    expect(pasteable('first\r\nsecond', true)).toBe('first\nsecond');
    expect(pasteable('one line', false)).toBe('one line');
    expect(pasteable('first\nsecond', false)).toEqual({ error: expect.stringMatching(/one line/) });
  });
});
