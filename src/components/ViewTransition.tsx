/**
 * Triggers a short fade-in animation each time `scopeKey` changes. We re-fire
 * the CSS animation by toggling its class instead of remounting children, so
 * stable view trees (e.g. ProjectView across project switches) don't lose
 * state mid-transition — only the animation replays.
 */

import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface ViewTransitionProps {
  scopeKey: string;
  children: ReactNode;
}

export function ViewTransition({ scopeKey, children }: ViewTransitionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastKey = useRef(scopeKey);

  useLayoutEffect(() => {
    if (lastKey.current === scopeKey) return;
    lastKey.current = scopeKey;
    const el = ref.current;
    if (!el) return;
    el.classList.remove('view-transition-enter');
    // Force reflow so re-adding the class restarts the animation.
    void el.offsetWidth;
    el.classList.add('view-transition-enter');
  }, [scopeKey]);

  return (
    <div ref={ref} className="view-transition-enter h-full">
      {children}
    </div>
  );
}
