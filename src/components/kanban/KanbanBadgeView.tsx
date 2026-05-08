import type { CSSProperties, ReactNode } from 'react';
import type { TaskChainInfo } from '../../utils/taskChain';
import { getChainBgColor, getChainColor, isChainMember } from '../../utils/taskChain';
import { Icon } from '../terminal/Icon';

export interface KanbanBadgeViewProps {
  taskNumber: number;
  chainInfo?: TaskChainInfo;
  /** Visual emphasis for drag/detach states. The wrapper sets these. */
  isDragging?: boolean;
  isDimmed?: boolean;
  shouldJitter?: boolean;
  /** Slot for the wrapper to inject the dnd-kit drag handle ref + listeners. */
  dragHandleProps?: Record<string, unknown>;
  /** Detach button rendered to the right when this task has a parent. */
  detachButton?: ReactNode;
}

/**
 * Pure visual badge for a task. Renders the rounded-pill chip with the
 * chain-derived color and the optional git-merge glyph for nested tasks.
 *
 * The smart DraggableBadge (in KanbanCard.tsx) wraps this with useDraggable,
 * Tooltip, and the detach affordance. The marketing site uses this directly.
 */
export function KanbanBadgeView({
  taskNumber,
  chainInfo,
  isDragging = false,
  isDimmed = false,
  shouldJitter = false,
  dragHandleProps,
  detachButton,
}: KanbanBadgeViewProps) {
  const isInChain = isChainMember(chainInfo);
  const color =
    isInChain && chainInfo ? getChainColor(chainInfo.rootTaskNumber, chainInfo.depth) : 'rgba(255, 255, 255, 0.2)';
  const background =
    isInChain && chainInfo ? getChainBgColor(chainInfo.rootTaskNumber, chainInfo.depth) : 'rgba(255, 255, 255, 0.04)';

  const style: CSSProperties = {
    color,
    background,
    ...(shouldJitter && { animation: 'chain-badge-jitter 0.4s ease-out forwards' }),
    ...(isDragging && { opacity: 0.3 }),
    ...(isDimmed && { opacity: 0.4 }),
  };

  return (
    <span
      className="group/badge inline-flex items-center gap-0.5 shrink-0 font-mono text-[11px] leading-none px-2 py-1 rounded-full whitespace-nowrap"
      style={style}
    >
      <span {...dragHandleProps} className="inline-flex items-center gap-0.5">
        {chainInfo && chainInfo.depth > 0 && <Icon name="git-merge" className="w-3 h-3" />}
        <span className="opacity-50">#</span>
        {taskNumber}
      </span>
      {detachButton}
    </span>
  );
}
