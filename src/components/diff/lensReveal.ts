import { useEffect, useRef, useState, type RefObject } from 'react';
import { useReadingAnchor } from './readingAnchor';

/** Matches `.lens-part-enter` in `index.css`. */
const PART_MS = 320;
const STEP_MS = 55;
/** Beyond this the stagger stops adding: a nine-part lens is not a countdown. */
const STEPS = 4;

export function partDelay(index: number): number {
  return Math.min(index, STEPS) * STEP_MS;
}

/**
 * A grouping arriving, as the pane showing it has to answer: the reader is held
 * where they were reading, and the parts lay themselves in from there.
 *
 * `revealing` is true on the render that first draws them, rather than set from
 * an effect: the class has to be on the parts in the first paint, or they appear
 * and then fade in from nothing.
 */
export function useLensReveal(landed: number, pane: RefObject<HTMLElement | null>): boolean {
  const seen = useRef(landed);
  const [revealing, setRevealing] = useState(false);
  const keepPlace = useReadingAnchor(pane);

  if (landed !== seen.current) {
    seen.current = landed;
    setRevealing(true);
  }

  useEffect(() => {
    if (landed) keepPlace();
  }, [landed, keepPlace]);

  useEffect(() => {
    if (!revealing) return;
    const done = setTimeout(() => setRevealing(false), PART_MS + partDelay(STEPS));
    return () => clearTimeout(done);
  }, [revealing, landed]);

  return revealing;
}
