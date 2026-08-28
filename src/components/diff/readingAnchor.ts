import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { fileSelector } from './scrollToSection';

/** The file at the top of the pane, and how far into it the reader is. */
interface Anchor {
  path: string;
  offset: number;
}

/**
 * Holds the reader's place across a relayout of the whole pane. A lens landing
 * rebuilds every card — they are keyed by the part that holds them, so React
 * keeps none of them — and the scroll offset the browser keeps through that is
 * by then a count of pixels into a different file.
 *
 * Only where the reader had scrolled: holding someone at the top to the first
 * file would put the part that file belongs to above the fold on arrival.
 */
export function useReadingAnchor(container: RefObject<HTMLElement | null>): () => void {
  const at = useRef<Anchor | null>(null);

  useEffect(() => {
    const pane = container.current;
    if (!pane) return;

    let queued = false;
    const measure = () => {
      queued = false;
      at.current = pane.scrollTop > 0 ? topFile(pane) : null;
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };

    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => pane.removeEventListener('scroll', onScroll);
  }, [container]);

  return useCallback(() => {
    const pane = container.current;
    const anchor = at.current;
    if (!pane || !anchor) return;

    const land = () => {
      const card = pane.querySelector(fileSelector(anchor.path));
      if (!card) return;
      pane.scrollTop += card.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset;
    };

    land();
    // Sections mounted by that scroll trade their estimated height for their
    // real one, moving the file it landed on. `scrollToSection` lands twice too.
    requestAnimationFrame(() => requestAnimationFrame(land));
  }, [container]);
}

/**
 * The first card reaching past the pane's top edge. Found by halving rather than
 * by reading the rect of every card above it: this runs on every scroll frame,
 * and a card three hundred files down would pay for all three hundred. The cards
 * are stacked down the pane and each mounted one sits inside its own
 * placeholder, so "reaches past the top edge" is false for a run of them and
 * then true for the rest.
 */
function topFile(pane: HTMLElement): Anchor | null {
  const top = pane.getBoundingClientRect().top;
  const cards = pane.querySelectorAll<HTMLElement>('[data-path]');

  let lo = 0;
  let hi = cards.length - 1;
  let found: HTMLElement | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cards[mid].getBoundingClientRect().bottom > top) {
      found = cards[mid];
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  if (!found?.dataset.path) return null;
  return { path: found.dataset.path, offset: found.getBoundingClientRect().top - top };
}
