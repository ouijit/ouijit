import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const FADE = 'linear-gradient(to right, black calc(100% - 24px), transparent)';

/** One line of text that fades out where it runs past its width, and is left alone where it fits. */
export function FadeLine({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);
  return (
    <span
      ref={ref}
      className={`min-w-0 overflow-hidden whitespace-nowrap ${className}`}
      style={overflows ? { maskImage: FADE, WebkitMaskImage: FADE } : undefined}
    >
      {children}
    </span>
  );
}
