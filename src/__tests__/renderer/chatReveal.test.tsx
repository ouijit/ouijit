import { describe, test, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { closeOpenMarkup, useReveal } from '../../components/chat/useReveal';
import { ChatTurns, RevealHeld, useRevealGate } from '../../components/chat/ChatTurns';
import type { ChatNode } from '../../chat/model';

afterEach(() => vi.useRealTimers());

describe('a message arriving while you watch', () => {
  test('is revealed a character at a time at an even pace that keeps up with the agent, and history shows whole', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const { result, rerender } = renderHook(({ text }) => useReveal(text, true), {
      initialProps: { text: words.slice(0, 200) },
    });
    expect(result.current).toBe('');

    act(() => vi.advanceTimersByTime(1000));
    // About 120 characters a second, and moving every frame rather than a word at a time.
    expect(result.current.length).toBeGreaterThan(105);
    expect(result.current.length).toBeLessThan(140);
    expect(words.startsWith(result.current)).toBe(true);
    const before16 = result.current.length;
    act(() => vi.advanceTimersByTime(16));
    expect(result.current.length - before16).toBeLessThanOrEqual(3);

    // Far behind, it catches up quickly, but never past the ceiling.
    const long = words.repeat(8);
    rerender({ text: long });
    const before = result.current.length;
    act(() => vi.advanceTimersByTime(1000));
    const gained = result.current.length - before;
    expect(gained).toBeGreaterThan(200);
    expect(gained).toBeLessThanOrEqual(410);

    // A frame stamped before the reveal began never shows text it has not reached.
    const early = renderHook(() => useReveal('one two three four five six', true));
    const now = performance.now();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    vi.spyOn(performance, 'now').mockReturnValue(now + 50);
    const stale = renderHook(() => useReveal('one two three four five six', true));
    act(() => vi.advanceTimersByTime(16));
    expect(stale.result.current.length).toBeLessThan(5);
    vi.mocked(performance.now).mockRestore();
    expect(early.result.current.length).toBeLessThan(5);

    const history = renderHook(() => useReveal(long, false));
    expect(history.result.current).toBe(long);
  });
});

describe('several things said while you watch', () => {
  test('arrive in order: nothing after a message still being revealed shows until it has caught up', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'Date'] });
    const at = Date.now();
    const first = `First part. ${'one two three four '.repeat(20)}end of first.`;
    const second = `Second part. ${'five six seven eight '.repeat(20)}end of second.`;
    const nodes = [
      { kind: 'user_message', id: 'u', parentId: null, createdAt: at, text: 'Go', attachments: [], delivery: 'prompt' },
      { kind: 'assistant_message', id: 'a1', parentId: null, createdAt: at, text: first, status: 'completed' },
      {
        kind: 'tool_call',
        id: 't1',
        parentId: null,
        createdAt: at,
        tool: 'command',
        title: 'git log',
        status: 'completed',
        files: [],
        output: '',
      },
      { kind: 'assistant_message', id: 'a2', parentId: null, createdAt: at, text: second, status: 'completed' },
    ] as ChatNode[];
    const context = { cardId: 'home-1', children: new Map(), canRewind: false, onRewind: () => {} };
    // The turn is under way when what it says arrives.
    const { rerender } = render(<ChatTurns nodes={nodes.slice(0, 1)} context={context} busy />);
    rerender(<ChatTurns nodes={nodes} context={context} busy />);
    rerender(<ChatTurns nodes={nodes} context={context} busy={false} />);

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText(/^First part\./)).toBeTruthy();
    expect(screen.queryByText(/end of first/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Ran 1 command/ })).toBeNull();
    expect(screen.queryByText(/Second part/)).toBeNull();

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText(/end of first/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ran 1 command/ })).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText(/^Second/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText(/end of second/)).toBeTruthy();
  });
});

describe('a decision card while Chat is still being revealed', () => {
  test('waits for the words before it, and once shown is not taken back', () => {
    let held = true;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RevealHeld.Provider value={held}>{children}</RevealHeld.Provider>
    );
    const { result, rerender } = renderHook(({ keys }) => useRevealGate(keys), {
      wrapper,
      initialProps: { keys: ['trash'] },
    });
    expect([...result.current]).toEqual([]);

    held = false;
    rerender({ keys: ['trash'] });
    expect([...result.current]).toEqual(['trash']);

    // More words start arriving: the card already up stays, a new one waits.
    held = true;
    rerender({ keys: ['trash', 'ask'] });
    expect([...result.current]).toEqual(['trash']);
    held = false;
    rerender({ keys: ['trash', 'ask'] });
    expect([...result.current]).toEqual(['trash', 'ask']);
  });
});

describe('opening a conversation', () => {
  test('shows what was already said whole, including history its agent sends again as it resumes', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'Date'] });
    const said = (id: string, text: string) =>
      ({ kind: 'assistant_message', id, parentId: null, createdAt: Date.now(), text, status: 'completed' }) as ChatNode;
    const context = { cardId: 'home-1', children: new Map(), canRewind: false, onRewind: () => {} };
    const { rerender } = render(
      <ChatTurns nodes={[said('a1', 'Already said before you opened it.')]} context={context} busy={false} />,
    );
    expect(screen.getByText('Already said before you opened it.')).toBeTruthy();

    // Resuming, the agent re-sends its history under new ids and fresh times, before any turn.
    rerender(<ChatTurns nodes={[said('h1', 'Already said before you opened it.')]} context={context} busy={false} />);
    expect(screen.getByText('Already said before you opened it.')).toBeTruthy();
    // And a turn starting later does not replay it.
    rerender(<ChatTurns nodes={[said('h1', 'Already said before you opened it.')]} context={context} busy />);
    expect(screen.getByText('Already said before you opened it.')).toBeTruthy();
  });
});

describe('formatting cut off mid-reveal', () => {
  test('renders as it will once whole, rather than as its markers', () => {
    expect(closeOpenMarkup('Run `ouijit pro')).toBe('Run `ouijit pro`');
    expect(closeOpenMarkup('This is **impor')).toBe('This is **impor**');
    expect(closeOpenMarkup('Half a marker *')).toBe('Half a marker ');
    expect(closeOpenMarkup('```bash\necho hi')).toBe('```bash\necho hi\n```');
    expect(closeOpenMarkup('`a` and **b** done')).toBe('`a` and **b** done');
    expect(closeOpenMarkup('```\n**x\n```\nafter **bo')).toBe('```\n**x\n```\nafter **bo**');
  });
});

describe('a turn still working', () => {
  test('says how long its current step has run, opens to every step so far, and stays open as it ends', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'Date'] });
    const at = Date.now();
    const step = (id: string, title: string, start: number, extra: object) =>
      ({
        kind: 'tool_call',
        id,
        parentId: null,
        createdAt: at + start,
        tool: 'command',
        title,
        command: 'npm test',
        files: [],
        output: '',
        ...extra,
      }) as ChatNode;
    const opener = {
      kind: 'user_message',
      id: 'u',
      parentId: null,
      createdAt: at,
      text: 'Go',
      attachments: [],
      delivery: 'prompt',
    } as ChatNode;
    const lint = step('t1', 'Run lint', 0, { status: 'completed', endedAt: at + 300_000 });
    const tests = (extra: object) => step('t2', 'Run driver tests', 300_000, extra);
    const context = { cardId: 'card-1', children: new Map(), canRewind: false, onRewind: () => {} };
    const running = [opener, lint, tests({ status: 'running', output: 'one\ntwo\nthree\nfour\n ✓ codex compacted\n' })];
    act(() => vi.setSystemTime(at + 420_000));
    const { rerender } = render(<ChatTurns nodes={running} context={context} busy />);

    // Closed, the line names the step and its own two minutes, not the turn's seven.
    const line = () => screen.getByRole('status', { name: 'Working' });
    expect(line().textContent).toBe('Run driver tests · 2m');

    // Opened, every step so far under the turn's total; the running command shows its latest output.
    act(() => screen.getByRole('button', { expanded: false }).click());
    expect(screen.getByRole('button', { name: /Ran 2 commands\s?· 7m/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run lint\s?· 5m/ })).toBeTruthy();
    const tail = [...document.querySelectorAll('pre')].map((pre) => pre.textContent);
    expect(tail).toEqual(['two\nthree\nfour\n ✓ codex compacted']);

    // Done, it is the fold, still open where the reader left it.
    const done = [opener, lint, tests({ status: 'completed', endedAt: at + 480_000, output: 'all passed' })];
    rerender(<ChatTurns nodes={done} context={context} busy={false} />);
    expect(screen.queryByRole('status', { name: 'Working' })).toBeNull();
    expect(screen.getByRole('button', { name: /Ran 2 commands\s?· 8m/, expanded: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run driver tests\s?· 3m/ })).toBeTruthy();
    vi.useRealTimers();
  });
});
