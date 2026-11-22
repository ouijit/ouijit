import { cloneElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import {
  FloatingDelayGroup,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
  type Placement,
} from '@floating-ui/react';

/**
 * A row whose tips share their timing: the first waits half a second, and
 * once one is up, moving along the row swaps to the next at once.
 */
export function PanelTipGroup({ children }: { children: ReactNode }) {
  return (
    <FloatingDelayGroup delay={{ open: 500, close: 120 }} timeoutMs={250}>
      {children}
    </FloatingDelayGroup>
  );
}

/**
 * A tooltip for the panel area's controls. It stays above or below, since
 * beside one control it would cover the next, and the element it wraps has
 * to take a ref and the hover props.
 */
export function PanelTip({
  children,
  tip,
  placement = 'bottom',
}: {
  children: ReactElement;
  tip: ReactNode;
  placement?: Placement;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    middleware: [offset(5), flip({ crossAxis: false }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { delay, isInstantPhase, currentId } = useDelayGroup(context, { id });
  const hover = useHover(context, { delay, move: false });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' }),
  ]);
  const swapping = isInstantPhase && currentId !== id;
  const { isMounted, styles } = useTransitionStyles(context, {
    duration: swapping ? { open: 0, close: 0 } : { open: 140, close: 80 },
    initial: { opacity: 0, transform: 'translateY(-3px)' },
  });
  return (
    <>
      {cloneElement(children, { ref: refs.setReference, ...getReferenceProps() } as Record<string, unknown>)}
      {isMounted && tip && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="z-[10010] pointer-events-none"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div style={styles}>{tip}</div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

const SURFACE = 'bg-terminal-surface border border-ink/10 shadow-tooltip';

/** What a control does, in a word or two. */
export function LabelTip({ text }: { text: string }) {
  return (
    <div className={`${SURFACE} rounded-md px-2 py-1 text-[12px] font-medium text-text-primary whitespace-nowrap`}>
      {text}
    </div>
  );
}

/** What a tab holds: its whole title, and where it points. */
export function TabTip({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
  return (
    <div className={`${SURFACE} rounded-lg px-3 py-2 flex gap-2.5 items-start`} style={{ maxWidth: 320 }}>
      <span className="mt-[2px] shrink-0 flex">{icon}</span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-medium text-text-primary leading-snug break-words [text-wrap:pretty]">
          {title}
        </span>
        {detail && <span className="text-[11.5px] font-mono text-text-tertiary truncate">{detail}</span>}
      </span>
    </div>
  );
}
