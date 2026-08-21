import { useEffect, useRef, useState, type ReactNode } from 'react';

interface DeferredMountProps {
  estimatedHeight: number;
  /** How far outside the viewport to start mounting. */
  rootMargin?: string;
  /** Copied onto the wrapper so a file can be scrolled to before it mounts. */
  dataPath?: string;
  children: ReactNode;
}

/**
 * Holds a section's place until it is nearly on screen, then mounts it, so a
 * large pull request doesn't lay out and tokenize every file up front.
 *
 * Mounting is one-way: unmounting again would bound the DOM further, but a
 * section can hold a half-written review comment.
 */
export function DeferredMount({ estimatedHeight, rootMargin = '150%', dataPath, children }: DeferredMountProps) {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mounted) return;
    const element = ref.current;
    if (!element) return;

    // Measured here rather than waiting a frame for the observer's first
    // callback. Under jsdom every rect is zero, so tests see the whole diff.
    const rect = element.getBoundingClientRect();
    const reach = window.innerHeight * 1.5;
    if (rect.top < window.innerHeight + reach && rect.bottom > -reach) {
      setMounted(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setMounted(true);
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted, rootMargin]);

  return (
    <div
      ref={ref}
      data-path={dataPath}
      // Clears the pinned header, so a file scrolled to shows its own top edge.
      style={{
        scrollMarginTop: '12px',
        ...(mounted ? null : { height: estimatedHeight }),
      }}
    >
      {mounted ? children : null}
    </div>
  );
}
