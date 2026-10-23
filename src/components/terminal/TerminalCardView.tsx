import type { CSSProperties, ReactNode } from 'react';

/** How far each card behind sits above the one in front: the strip of it that shows. */
export const STACK_PEEK = 24;

interface DepthStyle {
  translateY: number;
  scaleX: number;
  zIndex: number;
  boxShadow: string;
}

/* Blurred shadows only — a 1px ring here would stack with the card's
   bezel-panel border and read as a doubled, thicker edge on light themes. */
const DEPTH_STYLES: Record<number, DepthStyle> = {
  1: {
    translateY: -STACK_PEEK * 1,
    scaleX: 0.98,
    zIndex: 9,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
  },
  2: {
    translateY: -STACK_PEEK * 2,
    scaleX: 0.96,
    zIndex: 8,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
  },
  3: {
    translateY: -STACK_PEEK * 3,
    scaleX: 0.94,
    zIndex: 7,
    boxShadow: 'none',
  },
  4: {
    translateY: -STACK_PEEK * 4,
    scaleX: 0.92,
    zIndex: 6,
    boxShadow: 'none',
  },
};

function depthStyle(depth: number): DepthStyle {
  return (
    DEPTH_STYLES[depth] ?? {
      translateY: -STACK_PEEK * depth,
      scaleX: Math.max(0.8, 1 - 0.02 * depth),
      zIndex: 10 - depth,
      boxShadow: 'none',
    }
  );
}

const ACTIVE_STYLE: CSSProperties = {
  zIndex: 10,
  transform: 'translateY(0) scaleX(1)',
  boxShadow: 'var(--shadow-panel)',
};

export interface TerminalCardViewProps {
  isActive?: boolean;
  /** 0 = active, otherwise how many cards behind it */
  backDepth?: number;
  /** Adds a small upward lift when hovered behind cards */
  hoverLift?: number;
  ptyId?: string;
  /** What a pointer at this card is pointing at: see `pointKey`. */
  pointTarget?: string;
  className?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children?: ReactNode;
}

/**
 * Pure presentational terminal card chrome with the stack depth styling.
 * Used by the smart TerminalCard wrapper (which mounts xterm and reads stores)
 * and by the marketing site (which renders demo content as children).
 */
export function TerminalCardView({
  isActive = false,
  backDepth = 0,
  hoverLift = 0,
  ptyId,
  pointTarget,
  className,
  onClick,
  onMouseEnter,
  onMouseLeave,
  children,
}: TerminalCardViewProps) {
  const depthBase = !isActive && backDepth > 0 ? depthStyle(backDepth) : undefined;

  const style: CSSProperties = {
    background: 'var(--color-terminal-bg)',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    contain: 'layout style paint',
    ...(isActive
      ? ACTIVE_STYLE
      : depthBase
        ? {
            zIndex: depthBase.zIndex,
            transform: `translateY(${depthBase.translateY - hoverLift}px) scaleX(${depthBase.scaleX})`,
            boxShadow: depthBase.boxShadow,
          }
        : {}),
  };

  return (
    <div
      className={`project-card glass-bevel absolute inset-0 rounded-[14px] border border-bezel-panel overflow-hidden flex flex-col ${isActive ? 'project-card--active' : 'hover:border-accent'}${className ? ' ' + className : ''}`}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-pty-id={ptyId}
      data-point-target={pointTarget}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
