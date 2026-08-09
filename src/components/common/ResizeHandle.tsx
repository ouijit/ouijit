import { useCallback, type KeyboardEvent, type MouseEvent } from 'react';
import { Icon } from '../terminal/Icon';

interface ResizeHandleProps {
  /** Current width of the pane to the left of this handle. */
  width: number;
  onWidth: (width: number) => void;
  min?: number;
  max?: number;
  /** Double-clicking the handle returns to this. Omitted, it does nothing. */
  defaultWidth?: number;
  label?: string;
  /** With the pane collapsed there is nothing to drag — only the toggle. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  hideLabel?: string;
  showLabel?: string;
}

const STEP = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The line between a sidebar and what it opens: a hairline, the drag that sets
 * the width, and the toggle that puts the sidebar away.
 *
 * All three are one component because the toggle has to outlive the thing it
 * toggles. Everything on the right of this line is conditional — a pull
 * request, an issue, a spinner, an empty state — so a control living over there
 * can vanish, and one living in the sidebar goes with the sidebar. On the line
 * itself it is always exactly where it was.
 *
 * The rule is one pixel; the grab target is not. A one-pixel pointer target is
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
  collapsed,
  onCollapsedChange,
  hideLabel = 'Hide the sidebar',
  showLabel = 'Show the sidebar',
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
    <div className="relative z-10 w-px shrink-0 bg-ink/10 transition-colors duration-100 hover:bg-accent/60 active:bg-accent">
      {!collapsed && (
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
      )}

      {/* Sits clear of the line rather than centred on it, so that collapsed —
          with the pane edge immediately to the left — it is still whole. */}
      <button
        type="button"
        title={collapsed ? showLabel : hideLabel}
        aria-label={collapsed ? showLabel : hideLabel}
        aria-expanded={!collapsed}
        className="absolute top-3 left-[2px] w-5 h-5 rounded-md bg-terminal-surface border border-ink/10 text-ink/50 flex items-center justify-center transition-colors duration-150 hover:bg-ink/10 hover:text-ink/90 [&>svg]:w-3 [&>svg]:h-3"
        onClick={() => onCollapsedChange(!collapsed)}
      >
        <Icon name={collapsed ? 'caret-right' : 'caret-left'} />
      </button>
    </div>
  );
}
