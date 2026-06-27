import { type MouseEvent, type ReactNode, Fragment } from 'react';
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

  /** Identity slot (label, OSC title, optional rename input). Required. */
  nameContent: ReactNode;

  /** Tag chips. Optional. */
  tagsContent?: ReactNode;

  /** Branch row content (typically a copy-button). Rendered below the identity row when active. */
  branchContent?: ReactNode;

  /** Right-side action area (panel controls, add menu, etc.). */
  actions?: ReactNode;

  /** When true, renders a close × button to the right of actions. */
  showCloseButton?: boolean;
  onClose?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;

  /** Slot for dialogs and context menus the wrapper renders alongside. Rendered
   *  outside the header's flex row so it doesn't participate in layout. */
  overlays?: ReactNode;
}

/**
 * Pure presentational terminal header. Used by the smart TerminalHeader
 * wrapper (which fills slots with editable inputs, action groups, dialogs)
 * and by the marketing site (which composes nameContent/tagsContent inline
 * using the helpers below).
 */
export function TerminalHeaderView({
  summaryType,
  sandboxed = false,
  stackPosition,
  isActive = false,
  isBackCard = false,
  compact = false,
  nameContent,
  tagsContent,
  branchContent,
  actions,
  showCloseButton = false,
  onClose,
  onContextMenu,
  overlays,
}: TerminalHeaderViewProps) {
  return (
    <Fragment>
      {overlays}
      <div
        className={`flex items-center justify-between pl-3 pr-3 ${compact || isBackCard ? 'pt-0.5 pb-1' : 'py-2'} min-h-9`}
        onContextMenu={onContextMenu}
      >
        <div className="flex flex-col min-w-0 shrink gap-0.5">
          <div className="group/meta flex items-center gap-2 min-w-0">
            <StatusDot summaryType={summaryType} sandboxed={sandboxed} />
            {!isActive && stackPosition != null && stackPosition <= 9 && (
              <kbd className="inline-flex items-center font-mono text-base text-white/40 shrink-0">
                {isMac ? '⌘' : '⌃'}
                <span className="text-xs">{stackPosition}</span>
              </kbd>
            )}
            {nameContent}
            {tagsContent && <span className="inline-flex items-center gap-1 min-w-0 shrink-0">{tagsContent}</span>}
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
    </Fragment>
  );
}

/**
 * Standard identity content for a terminal header: label and optional OSC
 * title. Used by the in-app TerminalHeader (when not renaming) and by
 * marketing demos.
 */
export function TerminalHeaderName({ label, lastOscTitle }: { label?: string; lastOscTitle?: string }) {
  return (
    <Fragment>
      {label && <span className="font-mono text-xs font-medium text-white/85 shrink-0">{label}</span>}
      {lastOscTitle && (
        <span className="font-mono text-xs font-medium text-white/40 min-w-0 truncate">{lastOscTitle}</span>
      )}
    </Fragment>
  );
}

/** Standard pill renderer for a list of tag strings. */
export function TerminalHeaderTags({ tags }: { tags: string[] }) {
  return (
    <Fragment>
      {tags.map((tag) => (
        <span key={tag} className={METADATA_CHIP}>
          {tag}
        </span>
      ))}
    </Fragment>
  );
}
