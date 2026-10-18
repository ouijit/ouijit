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

export interface TooltipOptions {
  placement?: Placement;
  delay?: number;
  offsetPx?: number;
  disabled?: boolean;
  onHoverChange?: (hovering: boolean) => void;
  /** Let the text wrap, to this many pixels. One line by default. */
  wrapAt?: number;
}

export type TooltipReferenceProps = Record<string, unknown>;

/** Empty `text` shows nothing, so a conditional explanation can pass `undefined`. */
export function useTooltip(
  text: ReactNode,
  { placement = 'bottom', delay = 100, offsetPx = 6, disabled, onHoverChange, wrapAt }: TooltipOptions = {},
) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      setIsOpen(open);
      onHoverChange?.(open);
    },
    placement,
    strategy: 'fixed',
    middleware: [offset(offsetPx), flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { move: false, delay: { open: delay } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const shown = isOpen && !disabled && text != null && text !== '' && text !== false;

  const tooltip: ReactNode = shown
    ? createPortal(
        <div
          ref={refs.setFloating}
          className="fixed z-[10002] pointer-events-none"
          style={floatingStyles}
          {...getFloatingProps()}
        >
          <div
            className={`px-3 py-1.5 text-[13px] text-text-primary bg-terminal-surface border border-ink/10 rounded-md shadow-tooltip animate-tooltip-pop ${
              wrapAt ? 'leading-relaxed break-words' : 'font-medium whitespace-nowrap'
            }`}
            style={wrapAt ? { maxWidth: wrapAt } : undefined}
          >
            {text}
          </div>
        </div>,
        document.body,
      )
    : null;

  return {
    setReference: refs.setReference as (node: HTMLElement | null) => void,
    referenceProps: getReferenceProps() as TooltipReferenceProps,
    tooltip,
  };
}
