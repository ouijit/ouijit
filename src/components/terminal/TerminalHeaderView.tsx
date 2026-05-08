import { type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { StatusDot } from './StatusDot';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

const METADATA_CHIP =
  'inline-flex items-center gap-1 font-mono text-[11px] font-medium text-white/55 bg-white/[0.05] rounded-full px-2 py-0.5 shrink-0';

export interface TerminalHeaderViewProps {
  summaryType: string;
  sandboxed?: boolean;
  stackPosition?: number;
  isActive?: boolean;
  isBackCard?: boolean;
  compact?: boolean;

  /** Custom name/summary/title rendering. If omitted, label + summary + lastOscTitle are rendered statically. */
  nameContent?: ReactNode;
  label?: string;
  summary?: string;
  lastOscTitle?: string;

  /** Custom tag rendering. If omitted, static tag pills are rendered from `tags`. */
  tagsContent?: ReactNode;
  tags?: string[];

  /** Branch row content (typically a copy-button). Rendered below the identity row when active. */
  branchContent?: ReactNode;

  /** Right-side action area (ActionGroup, RunScriptDropdown anchor, etc.). */
  actions?: ReactNode;

  /** When true, renders a close × button to the right of actions. */
  showCloseButton?: boolean;
  onClose?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;

  /** Portal slot for dialogs and context menus the wrapper renders alongside. */
  overlays?: ReactNode;
}

/**
 * Pure presentational terminal header. Used by the smart TerminalHeader
 * wrapper (which fills slots with editable inputs, action groups, dialogs)
 * and by the marketing site (which passes only the static props).
 */
export function TerminalHeaderView({
  summaryType,
  sandboxed = false,
  stackPosition,
  isActive = false,
  isBackCard = false,
  compact = false,
  nameContent,
  label,
  summary,
  lastOscTitle,
  tagsContent,
  tags,
  branchContent,
  actions,
  showCloseButton = false,
  onClose,
  onContextMenu,
  overlays,
}: TerminalHeaderViewProps) {
  return (
    <div
      className={`flex items-center justify-between pl-3 pr-3 ${compact || isBackCard ? 'pt-0.5 pb-1' : 'py-2'} min-h-9`}
      onContextMenu={onContextMenu}
    >
      {overlays}
      <div className="flex flex-col min-w-0 shrink gap-0.5">
        <div className="group/meta flex items-center gap-2 min-w-0">
          <StatusDot summaryType={summaryType} sandboxed={sandboxed} />
          {!isActive && stackPosition != null && stackPosition <= 9 && (
            <kbd className="inline-flex items-center font-mono text-base text-white/40 shrink-0">
              {isMac ? '⌘' : 'Ctrl+'}
              <span className="text-xs">{stackPosition}</span>
            </kbd>
          )}
          {nameContent ??
            (label && <span className="font-mono text-xs font-medium text-white/85 shrink-0">{label}</span>)}
          {summary && !nameContent && (
            <span className="font-mono text-xs text-white/45 min-w-0 truncate">— {summary}</span>
          )}
          {lastOscTitle && !nameContent && (
            <span className="font-mono text-xs font-medium text-white/40 min-w-0 truncate">{lastOscTitle}</span>
          )}
          <span className="inline-flex items-center gap-1 min-w-0 shrink-0">
            {tagsContent ??
              tags?.map((tag) => (
                <span key={tag} className={METADATA_CHIP}>
                  {tag}
                </span>
              ))}
          </span>
        </div>
        {!compact && isActive && branchContent}
      </div>
      <div className="flex items-center gap-2 shrink-0 justify-end">
        {actions}
        {showCloseButton && (
          <button
            className="w-7 h-7 flex items-center justify-center bg-transparent border-none text-white/40 hover:text-white/90 transition-colors duration-150 ml-1 [&_svg]:w-4 [&_svg]:h-4"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        )}
      </div>
    </div>
  );
}
