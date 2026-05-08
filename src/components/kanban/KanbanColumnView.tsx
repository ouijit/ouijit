import type { MouseEvent, ReactNode, Ref } from 'react';
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
  children?: ReactNode;
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
  children,
}: KanbanColumnViewProps) {
  return (
    <div
      className="kanban-column flex flex-col transition-all duration-150 ease-out shrink-0 last:border-r-0"
      style={{ minWidth: 240, flex: '1 0 240px', borderRight: '1px solid rgba(255, 255, 255, 0.06)' }}
      data-status={status}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 h-[46px]">
        <span className="text-[13px] font-medium text-text-secondary uppercase tracking-wide flex-1">
          {label}
          <span className="kanban-column-count text-text-secondary opacity-50 normal-case tracking-normal ml-1.5">
            {count}
          </span>
        </span>
        {hookTypes.length > 0 && onConfigureHook && (
          <button
            className={`flex items-center justify-center border-none text-text-tertiary transition-all duration-150 ease-out rounded-md hover:text-text-secondary hover:bg-white/[0.08] [&>svg]:w-[18px] [&>svg]:h-[18px]${hasConfiguredHook ? ' !text-accent hover:!text-accent-hover' : ''}`}
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
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          scrollbarColor: 'transparent transparent',
          transition: 'background 150ms ease',
          minHeight: 80,
          background: isOver ? 'rgba(10, 132, 255, 0.08)' : undefined,
        }}
        onClick={onBodyClick}
      >
        {children}
      </div>
    </div>
  );
}
