import { useEffect, useRef, useState } from 'react';

/** Near reading pace: follows along rather than outrunning the eye. */
const BASE_CPS = 35;
/** However far behind, never faster than a reader can still scan. */
const MAX_CPS = 120;
/** How far behind the agent the reveal may fall before it speeds up. */
const CATCH_UP_SECONDS = 6;

/** The end of the word `index` falls in, so text is revealed a whole word at a time. */
function wordEnd(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const next = text.slice(index).search(/\s/);
  return next === -1 ? text.length : index + next;
}

/**
 * How much of `text` to show: all of it at once when `paced` is off, else
 * revealed at an even pace as it grows, however the agent's chunks arrive.
 */
export function useReveal(text: string, paced: boolean): string {
  const [shown, setShown] = useState(paced ? 0 : text.length);
  const target = useRef(text.length);
  target.current = text.length;
  const position = useRef(shown);

  useEffect(() => {
    if (!paced) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      const backlog = target.current - position.current;
      if (backlog > 0) {
        const cps = Math.min(MAX_CPS, Math.max(BASE_CPS, backlog / CATCH_UP_SECONDS));
        position.current = Math.min(target.current, position.current + cps * seconds);
        setShown(Math.floor(position.current));
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [paced]);

  if (!paced) return text;
  return text.slice(0, wordEnd(text, shown));
}

/** Whether the reveal has caught up with all there is. */
export function revealed(shown: string, text: string): boolean {
  return shown.length >= text.length;
}
