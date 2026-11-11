import { describe, test, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useReveal } from '../../components/chat/useReveal';
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
    render(<ChatTurns nodes={nodes} context={context} busy={false} />);

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
