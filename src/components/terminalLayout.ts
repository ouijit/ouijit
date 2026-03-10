/**
 * Terminal layout modes — grid, focus, and stack layout management
 *
 * Layout is purely visual: TerminalManager and OuijitTerminal are unchanged.
 * This module controls how .project-card elements are positioned within .project-stack.
 */

import { signal } from '@preact/signals-core';
import { OuijitTerminal, scrollSafeFit } from './terminal';

// ── Types & signal ──────────────────────────────────────────────────

export type TerminalLayout = 'stack' | 'grid' | 'focus';

export const terminalLayout = signal<TerminalLayout>('stack');

// ── Persistence ─────────────────────────────────────────────────────

export async function loadLayoutPreference(): Promise<void> {
  try {
    const saved = await window.api.globalSettings.get('terminalLayout');
    if (saved === 'grid' || saved === 'focus') terminalLayout.value = saved;
  } catch {
    // Default to stack
  }
}

export function setLayoutMode(mode: TerminalLayout): void {
  terminalLayout.value = mode;
  window.api.globalSettings.set('terminalLayout', mode);
}

// ── Toggle UI ───────────────────────────────────────────────────────

export function buildLayoutToggle(currentMode: TerminalLayout): string {
  return `<div class="project-view-toggle terminal-layout-toggle">
    <button class="project-view-toggle-btn${currentMode === 'stack' ? ' project-view-toggle-btn--active' : ''}" data-layout="stack" title="Stack">
      <i data-icon="cards-three"></i>
    </button>
    <button class="project-view-toggle-btn${currentMode === 'grid' ? ' project-view-toggle-btn--active' : ''}" data-layout="grid" title="Grid">
      <i data-icon="grid-four"></i>
    </button>
    <button class="project-view-toggle-btn${currentMode === 'focus' ? ' project-view-toggle-btn--active' : ''}" data-layout="focus" title="Focus">
      <i data-icon="sidebar"></i>
    </button>
  </div>`;
}

export function wireLayoutToggle(container: Element, onChange: (mode: TerminalLayout) => void): void {
  const toggle = container.querySelector('.terminal-layout-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.project-view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = (btn as HTMLElement).dataset.layout as TerminalLayout;
      if (!mode || mode === terminalLayout.value) return;
      // Update active state on buttons
      toggle.querySelectorAll('.project-view-toggle-btn').forEach(b =>
        b.classList.toggle('project-view-toggle-btn--active', (b as HTMLElement).dataset.layout === mode)
      );
      onChange(mode);
    });
  });
}

export function syncLayoutToggle(container: Element): void {
  const toggle = container.querySelector('.terminal-layout-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.project-view-toggle-btn').forEach(b =>
    b.classList.toggle('project-view-toggle-btn--active', (b as HTMLElement).dataset.layout === terminalLayout.value)
  );
}

// ── Cycle helper ────────────────────────────────────────────────────

const LAYOUT_CYCLE: TerminalLayout[] = ['stack', 'grid', 'focus'];

export function cycleLayout(): TerminalLayout {
  const idx = LAYOUT_CYCLE.indexOf(terminalLayout.value);
  return LAYOUT_CYCLE[(idx + 1) % LAYOUT_CYCLE.length];
}

// ── Grid resize handles ─────────────────────────────────────────────

/** Stored grid column/row ratios (reset when terminal count changes) */
let gridColRatios: number[] = [];
let gridRowRatios: number[] = [];
let gridTerminalCount = 0;

/** Active drag cleanup functions */
let gridDragCleanups: (() => void)[] = [];

function createGridResizeHandles(
  stack: HTMLElement,
  cols: number,
  rows: number,
  terminals: OuijitTerminal[],
): void {
  // Handles are position: absolute overlays at cell boundaries.
  // Compute boundary positions from current ratio arrays.
  const colSum = gridColRatios.reduce((a, b) => a + b, 0);
  const rowSum = gridRowRatios.reduce((a, b) => a + b, 0);

  // Vertical handles between columns
  let colAccum = 0;
  for (let col = 0; col < cols - 1; col++) {
    colAccum += gridColRatios[col];
    const pct = (colAccum / colSum) * 100;
    const handle = document.createElement('div');
    handle.className = 'grid-resize-handle-v';
    handle.style.left = `calc(${pct}% - 3px)`;
    handle.dataset.col = String(col);
    stack.appendChild(handle);

    const cleanup = setupGridDrag(handle, 'col', col, cols, rows, stack, terminals);
    gridDragCleanups.push(cleanup);
  }

  // Horizontal handles between rows
  let rowAccum = 0;
  for (let row = 0; row < rows - 1; row++) {
    rowAccum += gridRowRatios[row];
    const pct = (rowAccum / rowSum) * 100;
    const handle = document.createElement('div');
    handle.className = 'grid-resize-handle-h';
    handle.style.top = `calc(${pct}% - 3px)`;
    handle.dataset.row = String(row);
    stack.appendChild(handle);

    const cleanup = setupGridDrag(handle, 'row', row, cols, rows, stack, terminals);
    gridDragCleanups.push(cleanup);
  }
}

function setupGridDrag(
  handle: HTMLElement,
  axis: 'col' | 'row',
  index: number,
  cols: number,
  rows: number,
  stack: HTMLElement,
  terminals: OuijitTerminal[],
): () => void {
  let dragging = false;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = axis === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const rect = stack.getBoundingClientRect();

    if (axis === 'col') {
      const totalWidth = rect.width;
      const mouseX = e.clientX - rect.left;
      const ratio = mouseX / totalWidth;
      const minRatio = 0.1;
      const sumBefore = gridColRatios.slice(0, index).reduce((a, b) => a + b, 0);
      const sumPair = gridColRatios[index] + gridColRatios[index + 1];
      let leftRatio = ratio - sumBefore;
      leftRatio = Math.max(minRatio, Math.min(sumPair - minRatio, leftRatio));
      gridColRatios[index] = leftRatio;
      gridColRatios[index + 1] = sumPair - leftRatio;
      stack.style.gridTemplateColumns = gridColRatios.map(r => `${r}fr`).join(' ');
      // Move handle to match new boundary
      const colSum = gridColRatios.reduce((a, b) => a + b, 0);
      const accum = gridColRatios.slice(0, index + 1).reduce((a, b) => a + b, 0);
      handle.style.left = `calc(${(accum / colSum) * 100}% - 3px)`;
    } else {
      const totalHeight = rect.height;
      const mouseY = e.clientY - rect.top;
      const ratio = mouseY / totalHeight;
      const minRatio = 0.1;
      const sumBefore = gridRowRatios.slice(0, index).reduce((a, b) => a + b, 0);
      const sumPair = gridRowRatios[index] + gridRowRatios[index + 1];
      let topRatio = ratio - sumBefore;
      topRatio = Math.max(minRatio, Math.min(sumPair - minRatio, topRatio));
      gridRowRatios[index] = topRatio;
      gridRowRatios[index + 1] = sumPair - topRatio;
      stack.style.gridTemplateRows = gridRowRatios.map(r => `${r}fr`).join(' ');
      // Move handle to match new boundary
      const rowSum = gridRowRatios.reduce((a, b) => a + b, 0);
      const accum = gridRowRatios.slice(0, index + 1).reduce((a, b) => a + b, 0);
      handle.style.top = `calc(${(accum / rowSum) * 100}% - 3px)`;
    }
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Refit all terminals after resize
    fitAllTerminals(terminals);
  };

  handle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  return () => {
    handle.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}

function removeGridResizeHandles(stack: HTMLElement): void {
  for (const cleanup of gridDragCleanups) cleanup();
  gridDragCleanups = [];
  stack.querySelectorAll('.grid-resize-handle-h, .grid-resize-handle-v').forEach(el => el.remove());
}

// ── Layout apply functions ──────────────────────────────────────────

export function applyGridLayout(
  stack: HTMLElement,
  terminals: OuijitTerminal[],
  activeIndex: number,
): void {
  const count = terminals.length;
  if (count === 0) return;

  // Clean previous layout artifacts
  removeGridResizeHandles(stack);
  removeFocusSidebar(stack);
  stack.classList.remove('layout-focus');
  stack.classList.add('layout-grid');
  stack.style.removeProperty('top'); // CSS class handles top

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  // Reset ratios when terminal count changes
  if (count !== gridTerminalCount) {
    gridColRatios = Array(cols).fill(1);
    gridRowRatios = Array(rows).fill(1);
    gridTerminalCount = count;
  }

  stack.style.gridTemplateColumns = gridColRatios.map(r => `${r}fr`).join(' ');
  stack.style.gridTemplateRows = gridRowRatios.map(r => `${r}fr`).join(' ');

  // Position each terminal card
  terminals.forEach((term, index) => {
    stripStackClasses(term.container);
    term.container.style.display = '';

    if (index === activeIndex) {
      term.container.classList.add('project-card--active');
    }

    // Last row: span remaining columns if not full
    const row = Math.floor(index / cols);
    const col = index % cols;
    const isLastRow = row === rows - 1;
    const itemsInLastRow = count - (rows - 1) * cols;

    if (isLastRow && itemsInLastRow < cols) {
      // Span remaining columns for last item
      if (col === itemsInLastRow - 1) {
        term.container.style.gridColumn = `${col + 1} / ${cols + 1}`;
      }
    }
  });

  // Add resize handles
  if (cols > 1 || rows > 1) {
    createGridResizeHandles(stack, cols, rows, terminals);
  }

  // Fit all terminals after layout
  requestAnimationFrame(() => fitAllTerminals(terminals));
}

export function applyFocusLayout(
  stack: HTMLElement,
  terminals: OuijitTerminal[],
  activeIndex: number,
): void {
  const count = terminals.length;
  if (count === 0) return;

  // Clean previous layout artifacts
  removeGridResizeHandles(stack);
  stack.classList.remove('layout-grid');
  stack.classList.add('layout-focus');
  stack.style.removeProperty('top'); // CSS class handles top
  stack.style.removeProperty('grid-template-columns');
  stack.style.removeProperty('grid-template-rows');

  // Get or create sidebar
  let sidebar = stack.querySelector('.focus-sidebar') as HTMLElement;
  if (!sidebar) {
    sidebar = document.createElement('div');
    sidebar.className = 'focus-sidebar';
    stack.appendChild(sidebar);
  }

  // Position cards
  terminals.forEach((term, index) => {
    stripStackClasses(term.container);
    term.container.style.display = '';
    term.container.style.removeProperty('grid-column');

    if (index === activeIndex) {
      term.container.classList.add('focus-primary');
      // Ensure primary card is direct child of stack, not in sidebar
      if (term.container.parentElement !== stack) {
        stack.insertBefore(term.container, sidebar);
      }
    } else {
      term.container.classList.remove('focus-primary');
      // Move non-active cards into sidebar
      sidebar.appendChild(term.container);
    }
  });

  // Fit all terminals after layout
  requestAnimationFrame(() => fitAllTerminals(terminals));
}

function removeFocusSidebar(stack: HTMLElement): void {
  const sidebar = stack.querySelector('.focus-sidebar');
  if (sidebar) {
    // Move cards back to stack before removing sidebar
    const cards = sidebar.querySelectorAll('.project-card');
    cards.forEach(card => stack.appendChild(card));
    sidebar.remove();
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────

export function cleanupLayout(stack: HTMLElement): void {
  removeGridResizeHandles(stack);
  removeFocusSidebar(stack);
  stack.classList.remove('layout-grid', 'layout-focus');
  stack.style.removeProperty('grid-template-columns');
  stack.style.removeProperty('grid-template-rows');

  // Reset grid ratios
  gridTerminalCount = 0;
  gridColRatios = [];
  gridRowRatios = [];

  // Strip layout-specific classes from cards
  stack.querySelectorAll('.project-card').forEach(card => {
    (card as HTMLElement).classList.remove('focus-primary');
    (card as HTMLElement).style.removeProperty('grid-column');
  });
}

// ── Shared utility ──────────────────────────────────────────────────

export function stripStackClasses(card: HTMLElement): void {
  card.classList.remove(
    'project-card--active',
    'project-card--back-1',
    'project-card--back-2',
    'project-card--back-3',
    'project-card--back-4',
    'project-card--back-5',
    'project-card--back-6',
    'project-card--back-7',
    'project-card--back-8',
    'project-card--hidden',
    'focus-primary',
  );
  card.style.removeProperty('z-index');
  card.style.removeProperty('transform');
  card.style.removeProperty('left');
  card.style.removeProperty('right');
  card.style.removeProperty('grid-column');
}

function fitAllTerminals(terminals: OuijitTerminal[]): void {
  for (const term of terminals) {
    try {
      scrollSafeFit(term.xterm, term.fitAddon);
    } catch {
      // Terminal may not be visible
    }
  }
}

// ── High-level dispatch ─────────────────────────────────────────────

/**
 * Apply non-stack layout (grid or focus) to a terminal set.
 * Called from updateCardStack / updateHomeCardStack when layout !== 'stack'.
 */
export function applyNonStackLayout(
  stack: HTMLElement,
  terminals: OuijitTerminal[],
  activeIndex: number,
  mode: TerminalLayout,
): void {
  if (mode === 'grid') {
    applyGridLayout(stack, terminals, activeIndex);
  } else if (mode === 'focus') {
    applyFocusLayout(stack, terminals, activeIndex);
  }
}
