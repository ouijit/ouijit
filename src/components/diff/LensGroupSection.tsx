import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { partEnter } from './lensReveal';
import type { ResolvedGroup } from '../../lens/lens';
import { count } from '../../analysis/advice';
import { Icon } from '../terminal/Icon';

/**
 * Two things pin to the top of the pane, and they are a hierarchy: this header
 * publishes its own height as `--diff-sticky-offset`, which file headers pin
 * below. Measured rather than fixed because text grows with the platform's font
 * size; without a lens nothing publishes it and the fallback is `0px`.
 */
export function LensGroupSection({
  group,
  collapsed,
  onCollapsedChange,
  revealIndex,
  children,
}: {
  group: ResolvedGroup;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Its place in the stagger. Absent when the part is not entering. */
  revealIndex?: number;
  children: ReactNode;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const enter = partEnter(revealIndex);

  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) return;

    const measure = () => setHeaderHeight(element.getBoundingClientRect().height);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [group.title, group.summary]);

  return (
    // Identified, because one file can belong to three parts and the rail has to
    // say which copy a click meant.
    <div
      data-group={group.id}
      data-collapsed={collapsed ? '' : undefined}
      className={`lens-part diff-list flex flex-col ${enter.className}`}
      style={{ '--diff-sticky-offset': `${headerHeight}px`, ...enter.style } as CSSProperties}
    >
      <div ref={headerRef} className="pane-ledge-raised sticky top-0 z-20 bg-surface">
        <button
          type="button"
          aria-expanded={!collapsed}
          title={collapsed ? `${group.title} — click to unfold` : `Fold ${group.title} away`}
          className="w-full flex items-center gap-2 h-9 px-3 text-left transition-colors duration-150 ease-out hover:bg-ink/5"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <Icon name={collapsed ? 'caret-right' : 'caret-down'} className="shrink-0 !w-3 !h-3 text-ink/40" />
          <span
            className={`min-w-0 flex-1 truncate text-[12px] font-medium ${
              collapsed ? 'text-ink/45' : 'text-text-primary'
            }`}
          >
            {group.title}
          </span>
          {collapsed && (
            <span className="shrink-0 font-mono text-[11px] text-ink/35">{count(group.slices.length, 'file')}</span>
          )}
        </button>
      </div>

      {group.summary && !collapsed && (
        <p className="mx-6 max-w-[76ch] text-[12px] leading-relaxed text-ink/50">{group.summary}</p>
      )}
      {collapsed ? null : children}
    </div>
  );
}
