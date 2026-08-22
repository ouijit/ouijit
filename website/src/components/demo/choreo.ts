import { useEffect, useRef, useState, type RefObject } from 'react';

/** Whether the element is on screen — demos only animate while visible. */
export function useInView<T extends HTMLElement>(threshold = 0.3): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Looping choreography. `play` schedules its steps through `at(ms, fn)`,
 * resets its state synchronously, and returns the loop's total duration.
 * The loop runs only while `active`, never under prefers-reduced-motion,
 * and all pending timers are cleared when it stops.
 */
export function useLoop(active: boolean, play: (at: (ms: number, fn: () => void) => void) => number) {
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    const timers: number[] = [];
    const run = () => {
      const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
      const total = playRef.current(at);
      timers.push(window.setTimeout(run, total));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [active]);
}
