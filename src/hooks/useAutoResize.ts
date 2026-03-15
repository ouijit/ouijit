import { useCallback } from 'react';

/** Returns an onChange + onInput handler that auto-resizes a textarea to fit its content. */
export function useAutoResize() {
  return useCallback((e: React.ChangeEvent<HTMLTextAreaElement> | React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
}
