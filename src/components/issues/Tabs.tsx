import type { ReactNode } from 'react';

export function TabBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <nav className={`flex items-stretch gap-4 ${className}`}>{children}</nav>;
}

interface TabProps {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}

export function Tab({ active, onClick, count, children }: TabProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-0.5 border-b-2 -mb-px text-[13px] font-medium transition-colors duration-150 ${
        active ? 'border-accent text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'
      }`}
      onClick={onClick}
    >
      {children}
      {count != null && count > 0 && <span className="opacity-50 tabular-nums">{count}</span>}
    </button>
  );
}
