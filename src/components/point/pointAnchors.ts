/** Finding, on screen, the element a pointer should land on. */

import type { AnchorEntry } from './pointKeys';

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

function matches(entry: AnchorEntry): HTMLElement[] {
  const selector =
    typeof entry === 'string'
      ? `[data-point-target~="${entry}"]`
      : `[data-point-file~="${entry.file}"] [data-new-line="${entry.line}"]`;
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

export interface Anchor {
  el: HTMLElement;
  /** How far down the chain it was found: 0 is the target itself. */
  depth: number;
  side: 'right' | 'left' | 'below';
}

/**
 * The first key in `chain` that something on screen answers to. Where both the
 * sidebar and the main area show it, as a task's row and its board card do,
 * the main area's wins: it is the one the user is looking at.
 */
export function findAnchor(chain: AnchorEntry[]): Anchor | null {
  for (const [depth, entry] of chain.entries()) {
    const shown = matches(entry).filter(isShown);
    if (shown.length === 0) continue;
    const el = shown.find((candidate) => !candidate.closest('aside[aria-label="Sidebar"]')) ?? shown[0];
    const side = typeof entry === 'string' ? ((el.dataset.pointSide as Anchor['side'] | undefined) ?? 'right') : 'left';
    return { el, depth, side };
  }
  return null;
}

/** Scroll the target itself into view once it renders, giving up after a second. */
export function revealWhenShown(key: AnchorEntry): void {
  const deadline = performance.now() + 1000;
  const look = () => {
    const el = matches(key)[0];
    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
