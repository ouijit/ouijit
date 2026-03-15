import { useState, type ReactNode } from 'react';
import {
  useFloating,
  useHover,
  useDismiss,
  useInteractions,
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

export function Tooltip({ text, placement = 'top', delay = 50, children }: TooltipProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, { delay: { open: delay, close: 0 } });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss]);

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} style={{ display: 'inline-flex' }}>
        {children}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={`tooltip tooltip--visible`}
            role="tooltip"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {text}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
