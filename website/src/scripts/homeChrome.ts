/**
 * Shared behavior for the homepage: scroll reveal, the bento spotlight, and
 * the power-tool ribbons.
 * Reveal is rect-based rather than IntersectionObserver so it cannot strand
 * content invisible in browsers that throttle observers.
 */
export function initHomeChrome() {
  let pending = [...document.querySelectorAll('[data-reveal]')];

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
  };
  // Capture phase: the marketing body is its own scroll container, so
  // scroll events may fire there rather than on the window.
  document.addEventListener('scroll', checkScroll, { capture: true, passive: true });
  window.addEventListener('resize', checkScroll, { passive: true });
  checkScroll();

  initBentoSpotlight();
  initToolsRibbons();
}

/**
 * Drives the power-tool ribbons. The pointer's distance from the middle of the
 * band sets both the direction and the speed, so it steers rather than just
 * pausing; off the band it falls back to a slow drift left.
 *
 * One offset for both rows, not one each: the seam's columns only line up
 * while the rows stay in register, and the build already holds them to the
 * same run width.
 */
function initToolsRibbons() {
  const flow = document.querySelector<HTMLElement>('.tools-flow');
  const ribbons = flow ? [...flow.querySelectorAll<HTMLElement>('.tools-ribbon')] : [];
  if (!flow || !ribbons.length) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /** Drift with the pointer away, and its reach at either edge, in px/s. */
  const BASE = 22;
  const REACH = 240;
  /** How quickly the speed catches its target, so reversing eases. */
  const CATCH = 3.5;

  let pitch = 0;
  const measure = () => {
    const run = ribbons[0].querySelector<HTMLElement>('.tools-run');
    const gap = parseFloat(getComputedStyle(ribbons[0]).columnGap) || 0;
    // Stacked into one column the ribbons are display: contents and have no
    // box to move; pitch stays 0 and the loop leaves them alone.
    pitch = run && getComputedStyle(ribbons[0]).display !== 'contents' ? run.offsetWidth + gap : 0;
  };
  measure();
  addEventListener('resize', measure, { passive: true });

  let visible = false;
  new IntersectionObserver(([entry]) => void (visible = entry.isIntersecting)).observe(flow);

  let target = BASE;
  if (matchMedia('(pointer: fine)').matches) {
    flow.addEventListener('pointermove', (event) => {
      const rect = flow.getBoundingClientRect();
      const fromMiddle = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      target = REACH * fromMiddle;
    });
    for (const done of ['pointerleave', 'pointercancel']) {
      flow.addEventListener(done, () => void (target = BASE));
    }
  }

  let offset = 0;
  let speed = BASE;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (visible && pitch > 0) {
      speed += (target - speed) * Math.min(1, CATCH * dt);
      offset = (((offset + speed * dt) % pitch) + pitch) % pitch;
      for (const ribbon of ribbons) ribbon.style.transform = `translateX(${-offset}px)`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Walks the iris tier across the bento, one card at a time; hovering a card
 * takes the light, and the walk resumes from there when the cursor leaves. */
function initBentoSpotlight() {
  const tiles = [...document.querySelectorAll<HTMLElement>('.bento .detail')];
  if (!tiles.some((tile) => tile.querySelector('.bento-lit-field'))) return;

  /* A ribbon holds every card twice so it can loop, and both copies are on
     screen at once. Lighting one id rather than one element keeps a card and
     its double in step, instead of the light appearing to skip. */
  const ids = [...new Set(tiles.map((tile) => tile.dataset.tool ?? ''))];

  let index = 0;
  let hovered: string | null = null;
  const apply = () => {
    const lit = hovered ?? ids[index];
    tiles.forEach((tile) => tile.classList.toggle('is-lit', (tile.dataset.tool ?? '') === lit));
  };

  tiles.forEach((tile) => {
    const id = tile.dataset.tool ?? '';
    tile.addEventListener('pointerenter', () => {
      hovered = id;
      apply();
    });
    tile.addEventListener('pointerleave', () => {
      hovered = null;
      index = Math.max(0, ids.indexOf(id));
      apply();
    });
  });
  apply();

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let visible = false;
  const io = new IntersectionObserver(([entry]) => void (visible = entry.isIntersecting), { threshold: 0.15 });
  const flow = tiles[0]?.closest('.bento');
  if (flow) io.observe(flow);

  setInterval(() => {
    if (!visible || hovered !== null) return;
    index = (index + 1) % ids.length;
    apply();
  }, 2800);
}

