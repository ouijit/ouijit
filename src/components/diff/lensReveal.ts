import { useEffect, useRef, useState } from 'react';

/** Matches `.lens-part-enter` in `index.css`. */
const PART_MS = 320;
const STEP_MS = 55;
/** Beyond this the stagger stops adding: a nine-part lens is not a countdown. */
const STEPS = 4;

export function partDelay(index: number): number {
  return Math.min(index, STEPS) * STEP_MS;
}

/**
 * Whether a grouping that has just landed is still laying itself in.
 *
 * True on the render that first draws it, rather than set from an effect: the
 * class has to be on the parts in the first paint, or they appear and then fade
 * in from nothing.
 */
export function useLensReveal(landed: number): boolean {
  const seen = useRef(landed);
  const [revealing, setRevealing] = useState(false);

  if (landed !== seen.current) {
    seen.current = landed;
    setRevealing(true);
  }

  useEffect(() => {
    if (!revealing) return;
    const done = setTimeout(() => setRevealing(false), PART_MS + partDelay(STEPS));
    return () => clearTimeout(done);
  }, [revealing, landed]);

  return revealing;
}
