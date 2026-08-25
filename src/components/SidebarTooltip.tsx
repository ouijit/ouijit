import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  useHover,
  useDismiss,
  useRole,
  useInteractions,
} from '@floating-ui/react';

/**
 * A tooltip for a sidebar tile. Hands the reference ref and props to the
 * caller's own element, so the tile keeps its click handler and data
 * attributes instead of gaining a wrapper div.
 */
export function SidebarTooltipWrapper({
  label,
  children,
  disabled,
}: {
  label: string;
  children: (ref: (node: HTMLElement | null) => void, props: Record<string, unknown>) => React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: open && !disabled,
    onOpenChange: setOpen,
    placement: 'right',
    strategy: 'fixed',
    middleware: [offset(-4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false, delay: { open: 100 } });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role]);

  return (
    <>
      {children(refs.setReference as (node: HTMLElement | null) => void, getReferenceProps())}
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={refs.setFloating}
            className="fixed z-[10002] pointer-events-none"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div className="px-3 py-1.5 text-[13px] font-medium text-text-primary bg-terminal-surface border border-ink/10 rounded-md shadow-tooltip whitespace-nowrap animate-tooltip-pop">
              {label}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
