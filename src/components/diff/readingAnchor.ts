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

    // Re-queried when the document changes rather than on every scroll frame:
    // under a lens a file is on screen once per part that claims it.
    let cards: HTMLElement[] | null = null;
    const relayout = new MutationObserver(() => {
      cards = null;
    });
    relayout.observe(pane, { childList: true, subtree: true });

    let queued = false;
    const measure = () => {
      queued = false;
      cards ??= [...pane.querySelectorAll<HTMLElement>('[data-path]')];
      at.current = pane.scrollTop > 0 ? topFile(pane, cards) : null;
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };

    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      pane.removeEventListener('scroll', onScroll);
      relayout.disconnect();
    };
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
    // Sections mounted by that scroll trade their estimated height for their real
    // one, moving the file it landed on.
    requestAnimationFrame(() => requestAnimationFrame(land));
  }, [container]);
}

/**
 * The first card reaching past the pane's top edge. Halving is sound because the
 * cards are stacked down the pane, each inside its own placeholder: the test is
 * false for a run of them and then true for the rest.
 */
function topFile(pane: HTMLElement, cards: readonly HTMLElement[]): Anchor | null {
  const top = pane.getBoundingClientRect().top;

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
