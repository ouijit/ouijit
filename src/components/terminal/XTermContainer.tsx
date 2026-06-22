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

    // Defer fit to next frame — container may not have layout dimensions yet —
    // and grab keyboard focus. This component only renders for the active card,
    // so mounting here means a terminal just became visible (card switch, page
    // nav, project re-entry, session restore) and should be ready to type into.
    const raf = requestAnimationFrame(() => {
      instance.fit();
      const focused = document.activeElement;
      const editingElsewhere =
        focused instanceof HTMLElement &&
        (focused.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName));
      // Don't steal focus when mounted at zero width (hidden behind a
      // full-width panel) — the panel owns focus in that case.
      const visible = (containerRef.current?.offsetWidth ?? 0) > 0;
      if (!editingElsewhere && visible) instance.xterm.focus();
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
      className={className ?? 'terminal-xterm-container flex-1 min-h-0 min-w-0 overflow-hidden pt-4 pl-4 pr-2 pb-2'}
      style={{ background: 'var(--color-terminal-bg, #171717)', ...style }}
    />
  );
}
