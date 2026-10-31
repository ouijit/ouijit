/** Finding, on screen, the sidebar row a pointer should land on. */

function clips(el: HTMLElement): boolean {
  const { overflowX, overflowY } = getComputedStyle(el);
  return /auto|scroll|hidden|clip/.test(`${overflowX} ${overflowY}`);
}

/** Laid out, and not scrolled out of a box that clips it. */
export function isShown(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (!clips(parent)) continue;
    const box = parent.getBoundingClientRect();
    if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right)
      return false;
  }
  return true;
}

export interface Anchor {
  el: HTMLElement;
  /** How far down the chain it was found: 0 is the first row asked for. */
  depth: number;
}

/** The first key in `chain` that a row on screen answers to. */
export function findAnchor(chain: string[]): Anchor | null {
  for (const [depth, key] of chain.entries()) {
    const el = [...document.querySelectorAll<HTMLElement>(`[data-point-target~="${key}"]`)].find(isShown);
    if (el) return { el, depth };
  }
  return null;
}

/** Scroll a line of an opening diff into view once it renders, giving up after a second. */
export function revealDiffLine(path: string, line: number): void {
  const selector = `[data-path="${CSS.escape(path)}"] [data-new-line="${line}"]`;
  const deadline = performance.now() + 1000;
  const look = () => {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
