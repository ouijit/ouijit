/**
 * Jump a long diff to one of its sections.
 *
 * Instant, not smooth: animating past a long diff lays out and paints every
 * frame on the way. The landing repeats because sections mounted during the
 * jump replace their estimated heights and move the target.
 */
export function scrollToSection(container: HTMLElement | null, selector: string, within?: string): void {
  if (!container) return;
  // Optional calls: jsdom has no `scrollIntoView`. `within` is centred once
  // the section has mounted far enough to hold it, and the section until then.
  const land = () => {
    const inner = within ? container.querySelector(`${selector} ${within}`) : null;
    if (inner) inner.scrollIntoView?.({ block: 'center' });
    else container.querySelector(selector)?.scrollIntoView?.({ block: 'start' });
  };
  if (!container.querySelector(selector)) return;

  land();
  // Once for the mount the jump triggered, once more for the layout it costs.
  requestAnimationFrame(() => requestAnimationFrame(land));
  setTimeout(land, 250);
}

/** The section for one file, optionally the copy inside one part of a lens. */
export function fileSelector(path: string, group?: string): string {
  const file = `[data-path="${escapeValue(path)}"]`;
  return group ? `[data-group="${escapeValue(group)}"] ${file}` : file;
}

/** `CSS.escape` where there is one — jsdom has no `CSS` at all. */
function escapeValue(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
