import { type MouseEvent, type ReactNode, Fragment } from 'react';
import type { SandboxProviderId } from '../../types';
import { Icon } from './Icon';
import { StatusDot } from './StatusDot';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

const METADATA_CHIP =
  'inline-flex items-center gap-1 font-mono text-[11px] font-medium text-ink/55 bg-ink/[0.05] rounded-full px-2 py-0.5 shrink-0';

export interface TerminalHeaderViewProps {
  summaryType: string;
  sandboxProvider?: SandboxProviderId;
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
 * wrapper (which fills slots with editable inputs, action groups, dialogs).
 * The marketing site does not import this module; it keeps its own vendored
 * copy under website/src/ouijit-ui/, so the two can diverge independently.
 */
export function TerminalHeaderView({
  summaryType,
  sandboxProvider,
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
      {/* Raised over the terminal and the panel beside it, which the card sees
          to: see `.glass-bevel > .pane-ledge`.

          Only on the card that has a body — under a back card the cut would be
          a line along the card's own bottom edge. */}
      <div
        className={`${isActive ? 'pane-ledge ' : ''}flex items-center justify-between pl-3 pr-3 ${
          compact || isBackCard ? 'pt-0.5 pb-1' : 'py-2'
        } min-h-9`}
        onContextMenu={onContextMenu}
      >
        <div className="flex flex-col min-w-0 shrink gap-0.5">
          {/* overflow-hidden keeps rigid identity content (label, tag pills) from
              bleeding over the actions area when the header runs out of room. */}
          <div className="group/meta flex items-center gap-2 min-w-0 overflow-hidden">
            <StatusDot summaryType={summaryType} sandboxProvider={sandboxProvider} />
            {!isActive && stackPosition != null && stackPosition <= 9 && (
              <kbd className="inline-flex items-center font-mono text-base text-ink/40 shrink-0">
                {isMac ? '⌘' : '⌃'}
                <span className="text-xs">{stackPosition}</span>
              </kbd>
            )}
            {nameContent}
            {tagsContent && <span className="inline-flex items-center gap-1 min-w-0 shrink-0">{tagsContent}</span>}
          </div>
          {!compact && isActive && branchContent}
        </div>
        {/* Shrinkable so the panel tabs inside `actions` can give up width
            instead of overflowing the header. */}
        <div className="flex items-center gap-2 min-w-0 justify-end">
          {actions}
          {showCloseButton && (
            <button
              className="w-7 h-7 shrink-0 flex items-center justify-center bg-transparent border-none text-ink/40 hover:text-ink/90 transition-colors duration-150 ml-1 [&_svg]:w-4 [&_svg]:h-4"
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
      {label && <span className="font-mono text-xs font-medium text-ink/85 shrink-0">{label}</span>}
      {lastOscTitle && (
        <span className="font-mono text-xs font-medium text-ink/40 min-w-0 truncate">{lastOscTitle}</span>
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
