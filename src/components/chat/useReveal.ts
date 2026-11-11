import { useEffect, useRef, useState } from 'react';

/**
 * The aim is to even out the agent's bursts, not to slow it down: a floor
 * that keeps pace with a quick writer, catching up within a moment of the
 * agent, and a ceiling past which text would only flash by.
 */
const BASE_CPS = 120;
const MAX_CPS = 400;
const CATCH_UP_SECONDS = 1;

/**
 * How much of `text` to show: all of it at once when `paced` is off, else
 * revealed a character at a time, every frame, at an even pace as it grows,
 * however the agent's chunks arrive. A word at a time reads as clicking.
 */
export function useReveal(text: string, paced: boolean): string {
  const [shown, setShown] = useState(0);
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

  return paced ? text.slice(0, shown) : text;
}

/** Whether the reveal has caught up with all there is. */
export function revealed(shown: string, text: string): boolean {
  return shown.length >= text.length;
}
