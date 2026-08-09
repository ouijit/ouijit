import { useEffect, useRef, useState, type ReactNode } from 'react';

interface DeferredMountProps {
  /** Height the placeholder holds open until the real content replaces it. */
  estimatedHeight: number;
  /** How far outside the viewport to start mounting. */
  rootMargin?: string;
  /** Copied onto the wrapper so a file can be scrolled to before it mounts. */
  dataPath?: string;
  children: ReactNode;
}

/**
 * Holds a section's place until it is nearly on screen, then mounts it.
 *
 * A large pull request is thousands of diff lines, and mounting all of them
 * costs the same whether or not anyone scrolls that far: React builds the tree,
 * the browser lays it out, and every file asks to be tokenized at once. Opening
 * such a diff is the moment the pane feels slow, and it is entirely spent on
 * content nobody is looking at yet.
 *
 * Mounting is one-way. Unmounting again would bound the DOM further, but a
 * section can hold a half-written review comment, and no amount of scrolling
 * performance is worth throwing away something the user typed.
 */
export function DeferredMount({ estimatedHeight, rootMargin = '150%', dataPath, children }: DeferredMountProps) {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mounted) return;
    const element = ref.current;
    if (!element) return;

    // Whether this section is already in view is answered here rather than left
    // to the observer's first callback: the callback is a frame away, and in
    // that frame the reader would watch a blank placeholder be replaced by the
    // file they asked for. Every placeholder measures against the same layout,
    // so this costs one layout pass for the pane, not one per file.
    //
    // It is also what makes the component testable. Under jsdom every rect is
    // zero and every section is therefore "in view", so a test sees the whole
    // diff — which is what a test asking about a diff means.
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
      // Scrolled to, so it stops below whatever is pinned above it — a lens
      // publishes the height of its part header, and nothing publishes one
      // where there is no lens.
      style={{ scrollMarginTop: 'var(--diff-sticky-offset, 0px)', ...(mounted ? null : { height: estimatedHeight }) }}
    >
      {mounted ? children : null}
    </div>
  );
}
