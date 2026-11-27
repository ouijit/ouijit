import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const FADE = 'linear-gradient(to right, black calc(100% - 24px), transparent)';

/** One line of text that fades out where it runs past its width, and is left alone where it fits. */
export function FadeLine({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const measure = () => {
    const element = ref.current;
    if (element) setOverflows(element.scrollWidth > element.clientWidth);
  };
  // Every render: a style change, such as a title turning bold, can make it overflow at the same width.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <span
      ref={ref}
      className={`min-w-0 overflow-hidden whitespace-nowrap ${className}`}
      style={overflows ? { ...style, maskImage: FADE, WebkitMaskImage: FADE } : style}
    >
      {children}
    </span>
  );
}
