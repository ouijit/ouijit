import { useCallback } from 'react';

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
