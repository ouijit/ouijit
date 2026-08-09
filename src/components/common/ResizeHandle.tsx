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
 * The seam between a sidebar and what it opens, dragged to set the width.
 *
 * Drawn as a cut rather than a rule — see `.pane-seam` — so the two panes read
 * as pieces of one surface that has been parted, which is what they are.
 *
 * The seam is one pixel; the grab target is not. A one-pixel pointer target is
 * a game of skill, so an invisible strip either side takes the drag and the
 * pixel is what lights up.
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
      // Even with the wider grab strip this is the least reachable control on
      // the page, so it answers to arrow keys once focused as well.
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
    <div className="pane-seam relative w-px shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(width)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        title={defaultWidth != null ? `${label} — double-click to reset` : label}
        className="absolute inset-y-0 -left-1 -right-1 focus:outline-none"
        style={{ cursor: 'col-resize' }}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        onDoubleClick={defaultWidth != null ? () => onWidth(defaultWidth) : undefined}
      />
    </div>
  );
}
