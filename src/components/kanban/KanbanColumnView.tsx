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
  /** Short caption rendered in place of the count when set — used to surface
   *  modifier-key affordances mid-drag (e.g. "shift to skip hook"). */
  caption?: string;
  children?: ReactNode;
  /**
   * Pinned below the scrolling card list. The new-task composer lives here so
   * column length never pushes it out of view.
   */
  footer?: ReactNode;
}

/**
 * Pure presentational kanban column. No store reads, no dnd hooks.
 *
 * Used by the smart KanbanColumn wrapper (which attaches dnd-kit via bodyRef)
 * and by the marketing site (which omits bodyRef and renders static cards).
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
   * Publish the room a column has for its card list as `--kanban-body-h`, so
   * the composer can cap its description at a share of it without measuring
   * anything itself.
   *
   * Deliberately derived from the *column* rather than the card list: the
   * composer sits in the same flex column, so a cap measured off the live body
   * height would shrink as the composer grew, chasing its own tail. Column
   * height minus the header is fixed by the board, so the cap holds still.
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
      // The board is one surface parted into columns, not cards on a ground,
      // so what runs between them is a cut — and it belongs to the column,
      // which owns every vertical boundary here. A card owns the horizontal
      // ones between itself and the task below.
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
        // No border of its own: the header above owns that boundary, and the
        // two together were three lines stacked at the top of every column.
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
