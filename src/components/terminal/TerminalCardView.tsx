import type { CSSProperties, ReactNode } from 'react';

interface DepthStyle {
  translateY: number;
  scaleX: number;
  zIndex: number;
  boxShadow: string;
}

const DEPTH_STYLES: Record<number, DepthStyle> = {
  1: {
    translateY: -24,
    scaleX: 0.98,
    zIndex: 9,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.12)',
  },
  2: {
    translateY: -48,
    scaleX: 0.96,
    zIndex: 8,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 4px rgba(0, 0, 0, 0.08)',
  },
  3: {
    translateY: -72,
    scaleX: 0.94,
    zIndex: 7,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.08)',
  },
  4: {
    translateY: -96,
    scaleX: 0.92,
    zIndex: 6,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.06)',
  },
};

const ACTIVE_STYLE: CSSProperties = {
  zIndex: 10,
  transform: 'translateY(0) scaleX(1)',
  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
};

export interface TerminalCardViewProps {
  isActive?: boolean;
  /** 0 = active, 1..4 = depth behind the active card */
  backDepth?: number;
  /** Adds a small upward lift when hovered behind cards */
  hoverLift?: number;
  ptyId?: string;
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
  className,
  onClick,
  onMouseEnter,
  onMouseLeave,
  children,
}: TerminalCardViewProps) {
  const depthBase = !isActive && backDepth > 0 ? DEPTH_STYLES[Math.min(backDepth, 4)] : undefined;

  const style: CSSProperties = {
    background: 'var(--color-terminal-bg, #171717)',
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
      className={`project-card absolute inset-0 rounded-[14px] border border-black/60 overflow-hidden flex flex-col ${isActive ? 'project-card--active' : 'glass-bevel hover:border-accent'}${className ? ' ' + className : ''}`}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-pty-id={ptyId}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
