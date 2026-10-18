import type { ReactNode } from 'react';
import type { Placement } from '@floating-ui/react';
import { useTooltip } from './useTooltip';

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
  const { setReference, referenceProps, tooltip } = useTooltip(text, { placement });

  return (
    <>
      <button ref={setReference} className={className} onClick={onClick} disabled={disabled} {...referenceProps}>
        {children}
      </button>
      {tooltip}
    </>
  );
}
