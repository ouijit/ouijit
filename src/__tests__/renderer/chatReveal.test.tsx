import { describe, test, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReveal } from '../../components/chat/useReveal';

afterEach(() => vi.useRealTimers());

describe('a message arriving while you watch', () => {
  test('is revealed a word at a time near reading pace, speeds up only when far behind, and history shows whole', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const { result, rerender } = renderHook(({ text }) => useReveal(text, true), {
      initialProps: { text: words.slice(0, 120) },
    });
    expect(result.current).toBe('word0');

    act(() => vi.advanceTimersByTime(1000));
    // About 35 characters a second, ending on a whole word.
    expect(result.current.length).toBeGreaterThan(25);
    expect(result.current.length).toBeLessThan(50);
    expect(words.startsWith(result.current)).toBe(true);
    expect(/word\d+$/.test(result.current)).toBe(true);

    // Far behind, it speeds up, but never past the ceiling.
    const long = words.repeat(8);
    rerender({ text: long });
    const before = result.current.length;
    act(() => vi.advanceTimersByTime(1000));
    const gained = result.current.length - before;
    expect(gained).toBeGreaterThan(60);
    expect(gained).toBeLessThanOrEqual(130);

    const history = renderHook(() => useReveal(long, false));
    expect(history.result.current).toBe(long);
  });
});
