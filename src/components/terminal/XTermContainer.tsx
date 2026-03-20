import { useEffect, useRef } from 'react';
import { terminalInstances } from './terminalReact';

interface XTermContainerProps {
  ptyId: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Thin viewport wrapper that attaches/detaches an OuijitTerminal's xterm DOM.
 * The Terminal object lives outside React — this component just reparents
 * its viewport element on mount and detaches on unmount.
 */
export function XTermContainer({ ptyId, className, style }: XTermContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const instance = terminalInstances.get(ptyId);
    if (!containerRef.current || !instance) return;

    // Guard against StrictMode / HMR double-mount
    if (containerRef.current.children.length > 0) return;

    const viewport = instance.getViewportElement();
    containerRef.current.appendChild(viewport);
    instance.reattach();

    // Defer fit to next frame — container may not have layout dimensions yet
    const raf = requestAnimationFrame(() => {
      instance.fit();
    });

    return () => {
      cancelAnimationFrame(raf);
      instance.detach();
      viewport.remove();
    };
  }, [ptyId]);

  return (
    <div
      ref={containerRef}
      className={className ?? 'terminal-xterm-container flex-1 min-h-0 min-w-0 overflow-hidden p-4'}
      style={{ background: 'var(--color-terminal-bg, #171717)', ...style }}
    />
  );
}
