import type { ReactNode } from 'react';
import { useTooltip, type TooltipOptions, type TooltipReferenceProps } from './useTooltip';

interface TooltipProps extends TooltipOptions {
  text: ReactNode;
  referenceClassName?: string;
  referenceStyle?: React.CSSProperties;
  /**
   * An element, wrapped in a div that carries the tooltip; or a function that
   * puts the ref and props on an element of its own, where a wrapper would
   * break the layout (a flex child, a truncating span, a row in a list).
   */
  children: ReactNode | ((ref: (node: HTMLElement | null) => void, props: TooltipReferenceProps) => ReactNode);
}

export function Tooltip({ text, referenceClassName, referenceStyle, children, ...options }: TooltipProps) {
  const { setReference, referenceProps, tooltip } = useTooltip(text, options);

  return (
    <>
      {typeof children === 'function' ? (
        children(setReference, referenceProps)
      ) : (
        <div
          ref={setReference}
          {...referenceProps}
          className={referenceClassName ?? 'inline-flex'}
          style={referenceStyle}
        >
          {children}
        </div>
      )}
      {tooltip}
    </>
  );
}
