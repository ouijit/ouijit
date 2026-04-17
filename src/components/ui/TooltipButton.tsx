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

interface TooltipButtonProps {
  text: string;
  placement?: Placement;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * A button with a floating tooltip — no wrapper element.
 * Use this when the button must be a direct flex child (e.g. inside .project-view-toggle).
 */
export function TooltipButton({
  text,
  placement = 'bottom',
  className,
  onClick,
  disabled,
  children,
}: TooltipButtonProps) {
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

  return (
    <>
      <button
        ref={refs.setReference}
        className={className}
        onClick={onClick}
        disabled={disabled}
        {...getReferenceProps()}
      >
        {children}
      </button>
      {isOpen &&
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
