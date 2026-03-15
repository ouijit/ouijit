import { useState, type ReactNode } from 'react';
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
  FloatingPortal,
  type Placement,
} from '@floating-ui/react';

interface TooltipProps {
  text: string;
  placement?: Placement;
  delay?: number;
  children: ReactNode;
}

export function Tooltip({ text, placement = 'top', delay = 100, children }: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(6), flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { move: false, delay: { open: delay } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} style={{ display: 'inline-flex' }}>
        {children}
      </span>
      <FloatingPortal>
        {isOpen && (
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: 9999,
              padding: '6px 12px',
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              background: 'var(--color-surface, #2c2c2e)',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
            {...getFloatingProps()}
          >
            {text}
          </div>
        )}
      </FloatingPortal>
    </>
  );
}
