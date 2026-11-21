import { useCallback, useEffect, type RefObject } from 'react';

export function growToFit(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function useAutoResize() {
  return useCallback((e: React.ChangeEvent<HTMLTextAreaElement> | React.FormEvent<HTMLTextAreaElement>) => {
    growToFit(e.currentTarget);
  }, []);
}

/**
 * Fit again whenever the field's width changes: a layout change squeezes it
 * for a moment (a panel opening or closing beside it), its text or even its
 * placeholder wraps to many lines, and the height measured then would stick.
 */
export function useFitOnResize(ref: RefObject<HTMLTextAreaElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      growToFit(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
