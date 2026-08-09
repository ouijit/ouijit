/**
 * Jump a long diff to one of its sections.
 *
 * Instant rather than animated. A file list is navigation: the answer is the
 * new position, and half a second of watching a thousand lines of someone
 * else's code fly past is neither information nor pleasure — it is also the
 * most expensive way to arrive, since every frame of it lays out and paints
 * diff that nobody asked to see.
 *
 * The landing is repeated because the target may have been standing at an
 * estimated height and mounted on the way there, moving everything below it.
 * Landing again is idempotent when nothing moved, and invisible when it did.
 *
 * Shared by the two panes that navigate a diff from a file list, which have to
 * behave the same way: the worktree diff panel and the pull request code pane.
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

/** The section for one file, optionally the copy inside one part of a lens. */
export function fileSelector(path: string, group?: string): string {
  const file = `[data-path="${escapeValue(path)}"]`;
  return group ? `[data-group="${escapeValue(group)}"] ${file}` : file;
}

/** `CSS.escape` where there is one — jsdom has no `CSS` at all. */
function escapeValue(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
