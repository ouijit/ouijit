/**
 * Jump a long diff to one of its sections.
 *
 * Instant rather than animated: a file list is navigation, and smooth-scrolling
 * a long diff lays out and paints every frame it passes through.
 *
 * The landing is repeated because the target may have been standing at an
 * estimated height and mounted on the way there, moving everything below it.
 * Landing again is idempotent when nothing moved, and invisible when it did.
 */
export function scrollToSection(container: HTMLElement | null, selector: string): void {
  if (!container) return;
  // Optional call: jsdom has no `scrollIntoView`, and a navigation aid must
  // never take a click down with it.
  const land = () => container.querySelector(selector)?.scrollIntoView?.({ block: 'start' });
  if (!container.querySelector(selector)) return;

  land();
  // Once for the mount the jump triggered, and once more for the layout that
  // mounting a whole file costs — a placeholder's estimate is never exact.
  requestAnimationFrame(() => requestAnimationFrame(land));
  setTimeout(land, 250);
}

export function fileSelector(path: string): string {
  return `[data-path="${escapeValue(path)}"]`;
}

/** `CSS.escape` where there is one — jsdom has no `CSS` at all. */
function escapeValue(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
