import type { ReactNode } from 'react';

/**
 * Pinned exactly where the kanban board is, so the title bar toggle moves what
 * is inside the frame rather than the frame.
 */
export function PanelFrame({ children }: { children?: ReactNode }) {
  return (
    <div
      className="glass-bevel fixed top-[82px] bottom-4 z-[140] flex rounded-[14px] overflow-hidden border border-bezel-panel"
      style={{
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        right: 16,
        transition: 'left 0.2s ease-out',
        background: 'var(--color-terminal-bg)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      {children}
    </div>
  );
}
