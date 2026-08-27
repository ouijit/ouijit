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

function topFile(pane: HTMLElement): Anchor | null {
  const top = pane.getBoundingClientRect().top;
  for (const card of pane.querySelectorAll<HTMLElement>('[data-path]')) {
    const box = card.getBoundingClientRect();
    if (box.bottom > top && card.dataset.path) return { path: card.dataset.path, offset: box.top - top };
  }
  return null;
}
