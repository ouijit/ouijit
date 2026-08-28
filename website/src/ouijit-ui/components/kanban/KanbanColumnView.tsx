import { useEffect, useRef, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { HookType } from '../../types';
import { Icon } from '../terminal/Icon';

export interface KanbanColumnViewProps {
  status: string;
  label: string;
  count: number;
  hookTypes?: HookType[];
  hasConfiguredHook?: boolean;
  onConfigureHook?: (hookTypes: HookType[]) => void;
  isOver?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  onBodyClick?: (e: MouseEvent<HTMLDivElement>) => void;
  /** Replaces the count when set — used for mid-drag modifier hints. */
  caption?: string;
  children?: ReactNode;
  /**
   * Pinned below the scrolling card list, so the new-task composer stays in
   * view however long the column is.
   */
  footer?: ReactNode;
}

/**
 * Pure presentational kanban column: no store reads, no dnd hooks. The
 * marketing site renders it too, so it must stay free of both.
 */
export function KanbanColumnView({
  status,
  label,
  count,
  hookTypes = [],
  hasConfiguredHook = false,
  onConfigureHook,
  isOver = false,
  bodyRef,
  onBodyClick,
  caption,
  children,
  footer,
}: KanbanColumnViewProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  /**
   * Publishes the column's room for cards as `--kanban-body-h`, so the composer
   * can cap its description without measuring anything itself.
   *
   * Measured off the column, not the card list: the composer shares that flex
   * column, so a cap read from the live body height would shrink as the
   * composer grew. Column height minus the header is fixed by the board.
   */
  useEffect(() => {
    const column = columnRef.current;
    const header = headerRef.current;
    if (!column || !header || typeof ResizeObserver === 'undefined') return;

    const publish = () =>
      column.style.setProperty('--kanban-body-h', `${Math.max(0, column.clientHeight - header.offsetHeight)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={columnRef}
      // Columns own the board's vertical seams; cards own the horizontal ones.
      // The first column's exception is `.kanban-column:first-child`, which
      // must be CSS rather than a `first:` utility to outrank this.
      className="kanban-column pane-seam-left flex flex-col transition-all duration-150 ease-out shrink-0"
      style={{ minWidth: 240, flex: '1 0 240px' }}
      data-status={status}
    >
      <div ref={headerRef} className="pane-ledge relative z-10 flex items-center gap-2 px-3 py-2.5 shrink-0 h-[46px]">
        <span className="text-[13px] font-medium text-text-secondary tracking-wide flex-1">
          {label}
          {caption ? (
            <span className="text-text-secondary opacity-60 tracking-normal ml-1.5 text-[11px]">{caption}</span>
          ) : (
            <span className="kanban-column-count text-text-secondary opacity-50 tracking-normal ml-1.5">{count}</span>
          )}
        </span>
        {hookTypes.length > 0 && onConfigureHook && (
          <button
            className={`flex items-center justify-center border-none text-text-tertiary transition-all duration-150 ease-out rounded-md hover:text-text-secondary hover:bg-ink/[0.08] [&>svg]:w-[18px] [&>svg]:h-[18px]${hasConfiguredHook ? ' !text-accent hover:!text-accent-hover' : ''}`}
            style={{ padding: '4px 10px', background: 'transparent' }}
            onClick={() => onConfigureHook(hookTypes)}
          >
            <Icon name="webhooks-logo" />
          </button>
        )}
      </div>
      <div
        ref={bodyRef}
        className="kanban-column-body flex flex-col overflow-y-auto flex-1 min-h-0"
        // No border: the header above owns that boundary.
        style={{
          scrollbarColor: 'transparent transparent',
          transition: 'background 150ms ease',
          minHeight: 80,
          background: isOver ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : undefined,
        }}
        onClick={onBodyClick}
      >
        {children}
      </div>
      {footer && <div className="kanban-column-footer shrink-0">{footer}</div>}
    </div>
  );
}
