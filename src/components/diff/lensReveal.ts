import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useReadingAnchor } from './readingAnchor';

/** Matches `.lens-part-enter` in `index.css`. */
const PART_MS = 320;
const STEP_MS = 55;
const STEPS = 4;

function partDelay(index: number): number {
  return Math.min(index, STEPS) * STEP_MS;
}

export function partEnter(index: number | undefined): { className: string; style?: CSSProperties } {
  if (index === undefined) return { className: '' };
  return { className: 'lens-part-enter', style: { animationDelay: `${partDelay(index)}ms` } };
}

/**
 * Set in the render that first draws the parts rather than from an effect: the
 * class has to be on them in the first paint, or they appear and then fade in
 * from nothing.
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
