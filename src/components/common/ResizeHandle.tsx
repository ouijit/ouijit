import { useCallback, type KeyboardEvent, type MouseEvent } from 'react';

interface ResizeHandleProps {
  /** Current width of the pane to the left of this handle. */
  width: number;
  onWidth: (width: number) => void;
  min?: number;
  max?: number;
  /** Double-clicking the handle returns to this. Omitted, it does nothing. */
  defaultWidth?: number;
  label?: string;
}

const STEP = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The strip between a sidebar and what it opens, dragged to set the width.
 *
 * Shared by the diff panel and the pull request list rather than written once
 * per pane: two hand-rolled copies drift into two different feels — a different
 * minimum, a different hover colour, one that selects the text underneath while
 * you drag and one that does not.
 *
 * Dragging pins the cursor and suppresses selection for the duration. Without
 * that, a drag across a diff sweeps a selection over the code behind it and the
 * cursor flickers between `col-resize` and `text` as the pointer leaves the
 * three pixels of the handle.
 */
export function ResizeHandle({
  width,
  onWidth,
  min = 120,
  max = 500,
  defaultWidth,
  label = 'Resize',
}: ResizeHandleProps) {
  const onMouseDown = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;

      const body = document.body;
      const previousCursor = body.style.cursor;
      const previousSelect = body.style.userSelect;
      body.style.cursor = 'col-resize';
      body.style.userSelect = 'none';

      const onMove = (move: globalThis.MouseEvent) => onWidth(clamp(startWidth + move.clientX - startX, min, max));
      const onUp = () => {
        body.style.cursor = previousCursor;
        body.style.userSelect = previousSelect;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width, onWidth, min, max],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // A three-pixel drag target is the least reachable control on the page,
      // so it answers to arrow keys once focused as well.
      if (event.key === 'ArrowLeft') onWidth(clamp(width - STEP, min, max));
      else if (event.key === 'ArrowRight') onWidth(clamp(width + STEP, min, max));
      else if (event.key === 'Home') onWidth(min);
      else if (event.key === 'End') onWidth(max);
      else return;
      event.preventDefault();
    },
    [width, onWidth, min, max],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={defaultWidth != null ? `${label} — double-click to reset` : label}
      className="w-[3px] shrink-0 bg-ink/10 hover:bg-accent/60 active:bg-accent focus-visible:bg-accent focus:outline-none transition-colors duration-100"
      style={{ cursor: 'col-resize' }}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      onDoubleClick={defaultWidth != null ? () => onWidth(defaultWidth) : undefined}
    />
  );
}
