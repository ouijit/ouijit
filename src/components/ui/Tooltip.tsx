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

interface TooltipProps {
  text: ReactNode;
  placement?: Placement;
  delay?: number;
  disabled?: boolean;
  offsetPx?: number;
  referenceClassName?: string;
  referenceStyle?: React.CSSProperties;
  onHoverChange?: (hovering: boolean) => void;
  /**
   * Let the text wrap, to this many pixels.
   *
   * A tooltip is a label by default and stays on one line; a sentence needs
   * somewhere to break, and left to itself it would run off the window.
   */
  wrapAt?: number;
  children: ReactNode;
}

export function Tooltip({
  text,
  placement = 'bottom',
  delay = 100,
  disabled,
  offsetPx,
  referenceClassName,
  referenceStyle,
  onHoverChange,
  wrapAt,
  children,
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (open) => {
      setIsOpen(open);
      onHoverChange?.(open);
    },
    placement,
    strategy: 'fixed',
    middleware: [offset(offsetPx ?? 6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { move: false, delay: { open: delay } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <>
      <div
        ref={refs.setReference}
        {...getReferenceProps()}
        className={referenceClassName ?? 'inline-flex'}
        style={referenceStyle}
      >
        {children}
      </div>
      {isOpen &&
        !disabled &&
        createPortal(
          <div
            ref={refs.setFloating}
            className="fixed z-[10002] pointer-events-none"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div
              className={`px-3 py-1.5 text-[13px] text-text-primary bg-terminal-surface border border-ink/10 rounded-md shadow-tooltip animate-tooltip-pop ${
                wrapAt ? 'leading-relaxed' : 'font-medium whitespace-nowrap'
              }`}
              style={wrapAt ? { maxWidth: wrapAt } : undefined}
            >
              {text}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
