import { useEffect } from 'react';

/**
 * Escape, but only when nothing nearer has claimed it: a comment box, menu or
 * search field cancels itself first, and without this the same keypress would
 * also close the panel behind it.
 */
export function useEscape(onEscape: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      onEscape();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape]);
}
