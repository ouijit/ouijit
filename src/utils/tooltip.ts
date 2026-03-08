/**
 * Tooltip utility powered by Floating UI.
 * Provides positioned, animated tooltips.
 */

import { computePosition, offset, flip, shift, type Placement } from '@floating-ui/dom';

interface TooltipOptions {
  text: string;
  placement?: Placement;
  delay?: number;
}

let activeTooltip: HTMLElement | null = null;
let showTimeout: ReturnType<typeof setTimeout> | null = null;

function clearPending(): void {
  if (showTimeout !== null) {
    clearTimeout(showTimeout);
    showTimeout = null;
  }
}

function hideActive(): void {
  clearPending();
  if (activeTooltip) {
    activeTooltip.classList.remove('tooltip--visible');
    const el = activeTooltip;
    setTimeout(() => el.remove(), 60);
    activeTooltip = null;
  }
}

async function show(trigger: HTMLElement, text: string, placement: Placement): Promise<void> {
  hideActive();

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = text;

  document.body.appendChild(tip);
  activeTooltip = tip;

  const { x, y } = await computePosition(trigger, tip, {
    placement,
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
    ],
  });

  Object.assign(tip.style, {
    left: `${x}px`,
    top: `${Math.max(y, 62)}px`,
  });

  requestAnimationFrame(() => tip.classList.add('tooltip--visible'));
}

/**
 * Attach a tooltip to an element. Returns a cleanup function.
 * Removes any native `title` attribute to prevent double tooltips.
 */
export function addTooltip(el: HTMLElement, options: TooltipOptions): () => void {
  const { text, placement = 'right', delay = 50 } = options;

  el.removeAttribute('title');

  const onEnter = () => {
    clearPending();
    showTimeout = setTimeout(() => show(el, text, placement), delay);
  };

  const onLeave = () => {
    hideActive();
  };

  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mouseleave', onLeave);
  el.addEventListener('mousedown', onLeave);

  return () => {
    el.removeEventListener('mouseenter', onEnter);
    el.removeEventListener('mouseleave', onLeave);
    el.removeEventListener('mousedown', onLeave);
    hideActive();
  };
}
