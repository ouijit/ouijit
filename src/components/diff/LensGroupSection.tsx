import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ResolvedGroup } from '../../github/lens';
import { Icon } from '../terminal/Icon';

/**
 * One part of a lens, with the files that make it up.
 *
 * Shared by the pull request files view and the worktree diff panel, which read
 * the same grouping through the same `resolveLens`.
 *
 * Two things pin themselves to the top of the pane — which part of the change
 * you are in, and which file you are in — and they are a hierarchy, not rivals
 * for the same line. Both were pinned to `top: 0`, so the file header sat on
 * top of the part it belongs to and the lens became invisible exactly when it
 * was being used.
 *
 * The part header measures itself and publishes its height, and file headers
 * pin below it. Measured rather than hard-coded to the one line it is set to:
 * the number this has to agree with is a rendered height, and text that grows
 * with the platform's font size would leave a fixed offset behind. Nothing
 * publishes it without a lens, and the fallback of `0px` is what every other
 * diff in the app already does.
 */
export function LensGroupSection({
  group,
  collapsed,
  onCollapsedChange,
  children,
}: {
  group: ResolvedGroup;
  /** Folded to its header alone, the way a file folds to its own. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

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
    // Named, because one file can belong to three parts and the rail has to be
    // able to say which copy of it a click meant.
    <div
      data-group={group.title}
      data-collapsed={collapsed ? '' : undefined}
      className="diff-list flex flex-col"
      style={{ '--diff-sticky-offset': `${headerHeight}px` } as CSSProperties}
    >
      {/* One line, at the height of a file header: the two pin one above the
          other, and the rail beside them lists its actions on the same unit,
          so the whole band across the seam is level.

          The whole line folds it. A part of a change is read and finished with
          the same way a file is, and nothing else in this header competes for
          the press. */}
      <div ref={headerRef} className="pane-ledge-raised over-well sticky top-0 z-20 bg-surface">
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
          {/* Folded, the part has to say what is inside it — otherwise the only
              way to know what you skipped is to unfold it again. */}
          {collapsed && (
            <span className="shrink-0 font-mono text-[11px] text-ink/35">
              {group.slices.length} {group.slices.length === 1 ? 'file' : 'files'}
            </span>
          )}
        </button>
      </div>

      {/* What the part is, said in full.
       *
       * In the document rather than in the bar above it: a summary is prose
       * about the change, and prose in a one-line sticky header is prose with
       * its end cut off. Down here it wraps, it can be selected, and it costs
       * the header none of its height.
       *
       * Plain text on the well — no card of its own, because it is not one of
       * the files, and it goes away with them: folding a part puts the whole
       * part away, and a description left behind is the part still talking. */}
      {group.summary && !collapsed && (
        <p className="mx-6 max-w-[76ch] text-[12px] leading-relaxed text-ink/50">{group.summary}</p>
      )}
      {collapsed ? null : children}
    </div>
  );
}
