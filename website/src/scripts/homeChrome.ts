/**
 * Shared behavior for the homepage concepts: scroll reveal, the floating
 * sub-nav pill, and the bento cursor spotlight. Reveal is rect-based rather
 * than IntersectionObserver so it cannot strand content invisible in
 * browsers that throttle observers.
 */
export function initHomeChrome() {
  let pending = [...document.querySelectorAll('[data-reveal]')];
  const floatNav = document.querySelector('.float-nav');
  const hero = document.querySelector('.hero');

  const checkScroll = () => {
    if (pending.length) {
      const limit = window.innerHeight * 0.94;
      pending = pending.filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < limit && rect.bottom > 0) {
          el.classList.add('is-revealed');
          return false;
        }
        return true;
      });
    }
    if (floatNav && hero) {
      floatNav.classList.toggle('is-shown', hero.getBoundingClientRect().bottom < 64);
    }
  };
  // Capture phase: the marketing body is its own scroll container, so
  // scroll events may fire there rather than on the window.
  document.addEventListener('scroll', checkScroll, { capture: true, passive: true });
  window.addEventListener('resize', checkScroll, { passive: true });
  checkScroll();

  document.querySelectorAll<HTMLElement>('.bento .detail').forEach((tile) => {
    tile.addEventListener('pointermove', (event) => {
      const rect = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      tile.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });
}

/** Progress of the viewport through an element, clamped to [0, 1]. */
export function scrollProgress(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const range = rect.height - window.innerHeight;
  if (range <= 0) return rect.top < 0 ? 1 : 0;
  return Math.min(1, Math.max(0, -rect.top / range));
}
