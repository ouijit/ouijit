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
  onClick?: (e: React.MouseEvent) => void;
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
  onClick,
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
        onClick={onClick}
      >
        {children}
      </div>
      {isOpen &&
        !disabled &&
        createPortal(
          <div
            ref={refs.setFloating}
            className="fixed z-[10000] pointer-events-none"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div className="px-3 py-1.5 text-[13px] font-medium text-white bg-neutral-800 border border-white/10 rounded-md shadow-lg whitespace-nowrap animate-tooltip-pop">
              {text}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
