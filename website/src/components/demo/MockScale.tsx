import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Draws a mock at the width the app's own layout needs, and scales the whole
 * thing down to whatever the page can give it. What is inside is real app
 * chrome — columns, rails and split panes with min-widths of their own — so a
 * narrow window either scales them or tears them apart, and a phone-sized
 * window is far below any of their minimums.
 *
 * Above `width` nothing happens: the mock fills its container the way it does
 * on a desktop.
 */
export function MockScale({ width, children }: { width: number; children: ReactNode }) {
  const frame = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>();

  useEffect(() => {
    const frameEl = frame.current;
    const innerEl = inner.current;
    if (!frameEl || !innerEl) return;
    const measure = () => {
      const available = frameEl.getBoundingClientRect().width;
      const next = Math.min(1, available / width);
      setScale(next);
      /* offsetHeight, not the bounding box: the box is already scaled, so
         feeding it back would shrink the frame on every measure. */
      setHeight(next < 1 ? innerEl.offsetHeight * next : undefined);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frameEl);
    observer.observe(innerEl);
    return () => observer.disconnect();
  }, [width]);

  return (
    /* `contain: inline-size` so the frame takes its width from the page rather
       than from the mock: a fixed-width block that reports its width as a
       minimum widens every ancestor up to the section. */
    <div ref={frame} style={{ height, contain: 'inline-size' }}>
      <div
        ref={inner}
        style={{
          width: scale < 1 ? width : '100%',
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}
