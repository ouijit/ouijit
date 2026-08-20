/**
 * Jump a long diff to one of its sections.
 *
 * Instant, not smooth: animating past a long diff lays out and paints every
 * frame on the way. The landing repeats because sections mounted during the
 * jump replace their estimated heights and move the target.
 */
export function scrollToSection(container: HTMLElement | null, selector: string): void {
  if (!container) return;
  // Optional call: jsdom has no `scrollIntoView`.
  const land = () => container.querySelector(selector)?.scrollIntoView?.({ block: 'start' });
  if (!container.querySelector(selector)) return;

  land();
  // Once for the mount the jump triggered, once more for the layout it costs.
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
