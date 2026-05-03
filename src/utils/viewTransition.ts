/**
 * Wraps a state mutation in `document.startViewTransition` so the browser
 * snapshots the old DOM, applies the change, then crossfades to the new DOM
 * via the CSS in index.css (`::view-transition-old(root)` /
 * `::view-transition-new(root)`).
 *
 * Falls back to running the action immediately on browsers without the API
 * (Chromium ≥ 111 has it; bundled Electron Chromium does too).
 */

export type ViewTransitionDirection = 'up' | 'down';

interface ViewTransitionLike {
  finished: Promise<unknown>;
}

interface ViewTransitionOptions {
  /** Adds `view-transition-up` or `view-transition-down` to the root for the
   *  duration of the transition so CSS can pick a directional animation. */
  direction?: ViewTransitionDirection;
}

export function withViewTransition(action: () => void, options: ViewTransitionOptions = {}): void {
  const start = (document as Document & { startViewTransition?: (cb: () => void) => ViewTransitionLike })
    .startViewTransition;
  if (typeof start !== 'function') {
    action();
    return;
  }

  const root = document.documentElement;
  if (options.direction) {
    root.classList.add(`view-transition-${options.direction}`);
  }

  const transition = start.call(document, action);
  void transition.finished.finally(() => {
    root.classList.remove('view-transition-up', 'view-transition-down');
  });
}
