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

  initBentoSpotlight();
}

/** Walks the iris tier across the bento, one card at a time; hovering a card
 * takes the light, and the walk resumes from there when the cursor leaves. */
function initBentoSpotlight() {
  const tiles = [...document.querySelectorAll<HTMLElement>('.bento .detail')];
  if (!tiles.some((tile) => tile.querySelector('.bento-lit-field'))) return;

  let index = 0;
  let hovered: number | null = null;
  const apply = () => {
    const lit = hovered ?? index;
    tiles.forEach((tile, i) => tile.classList.toggle('is-lit', i === lit));
  };

  tiles.forEach((tile, i) => {
    tile.addEventListener('pointerenter', () => {
      hovered = i;
      apply();
    });
    tile.addEventListener('pointerleave', () => {
      hovered = null;
      index = i;
      apply();
    });
  });
  apply();

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let visible = false;
  const io = new IntersectionObserver(([entry]) => void (visible = entry.isIntersecting), { threshold: 0.15 });
  const grid = tiles[0]?.parentElement;
  if (grid) io.observe(grid);

  setInterval(() => {
    if (!visible || hovered !== null) return;
    index = (index + 1) % tiles.length;
    apply();
  }, 2800);
}

/** Splits `.b-pitch-text` into word spans that light up as it crosses the viewport. */
export function initPitchIllumination() {
  const pitch = document.querySelector<HTMLElement>('.b-pitch-text');
  if (!pitch || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const text = (pitch.textContent ?? '').trim().replace(/\s+/g, ' ');
  pitch.textContent = '';
  for (const word of text.split(' ')) {
    const span = document.createElement('span');
    span.className = 'b-pitch-w';
    span.textContent = word;
    pitch.append(span, ' ');
  }
  const words = [...pitch.querySelectorAll<HTMLElement>('.b-pitch-w')];
  pitch.classList.add('is-live');

  const scroller = document.scrollingElement ?? document.documentElement;

  const onScroll = () => {
    const rect = pitch.getBoundingClientRect();
    const start = window.innerHeight * 0.9;
    // If the page ends soon after the pitch, the paragraph can't climb to the
    // usual finish line — move the line down to the highest reachable point.
    const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const end = Math.min(start - 1, Math.max(window.innerHeight * 0.4, rect.top - remaining));
    const f = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
    const lit = Math.round(f * words.length);
    words.forEach((w, i) => w.classList.toggle('is-lit', i < lit));
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();
}

/** Progress of the viewport through an element, clamped to [0, 1]. */
export function scrollProgress(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const range = rect.height - window.innerHeight;
  if (range <= 0) return rect.top < 0 ? 1 : 0;
  return Math.min(1, Math.max(0, -rect.top / range));
}
