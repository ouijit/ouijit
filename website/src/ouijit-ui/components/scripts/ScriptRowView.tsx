import type { CSSProperties, MouseEvent, Ref } from 'react';
import { Icon } from '../terminal/Icon';

export interface ScriptRowViewProps {
  name: string;
  command: string;
  expanded?: boolean;
  /** Drag handle props (forwarded from useSortable in the wrapper). Omit for marketing. */
  dragHandleRef?: Ref<HTMLButtonElement>;
  dragHandleProps?: Record<string, unknown>;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
}

/**
 * Pure visual row for a single project script. Used by ScriptList's sortable
 * wrapper (which fills the dnd handle props) and by the marketing site's
 * Automation demo (which omits them).
 */
export function ScriptRowView({
  name,
  command,
  expanded = false,
  dragHandleRef,
  dragHandleProps,
  containerRef,
  containerStyle,
  onClick,
}: ScriptRowViewProps) {
  return (
    <div ref={containerRef} style={containerStyle}>
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors duration-100"
        onClick={onClick}
      >
        <button
          ref={dragHandleRef}
          className="flex items-center justify-center w-5 h-5 text-text-tertiary hover:text-text-secondary shrink-0 touch-none"
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="dots-six-vertical" className="w-4 h-4" />
        </button>
        <span className="text-xs font-medium text-text-primary truncate">{name}</span>
        <span className="text-[11px] text-text-tertiary truncate ml-auto font-mono">{command}</span>
        <Icon name={expanded ? 'caret-down' : 'caret-right'} className="w-3 h-3 text-text-tertiary shrink-0" />
      </div>
    </div>
  );
}
