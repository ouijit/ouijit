import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  autoUpdate,
  offset,
  flip,
  shift,
  type Placement,
} from '@floating-ui/react';

interface UseTooltipOptions {
  placement?: Placement;
  disabled?: boolean;
}

export function useTooltip(text: string, { placement = 'bottom', disabled }: UseTooltipOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    strategy: 'fixed',
    middleware: [offset(6), flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { move: false, delay: { open: 100 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const tooltip: ReactNode =
    isOpen && !disabled
      ? createPortal(
          <div
            ref={refs.setFloating}
            className="fixed z-[10002] pointer-events-none"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div className="px-3 py-1.5 text-[13px] font-medium text-text-primary bg-terminal-surface border border-ink/10 rounded-md shadow-tooltip whitespace-nowrap animate-tooltip-pop">
              {text}
            </div>
          </div>,
          document.body,
        )
      : null;

  return {
    setReference: refs.setReference,
    // The tooltip is the only name the trigger has, and it is only there on
    // hover — so it is the accessible name too.
    referenceProps: { 'aria-label': text, ...getReferenceProps() },
    tooltip,
  };
}
