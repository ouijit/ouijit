import type { ReactNode } from 'react';
import { Icon } from '../terminal/Icon';
import { SidebarToggle } from '../common/SidebarToggle';
import { useGithubStore } from '../../stores/githubStore';
import { RefreshButton } from './RefreshButton';
import { Tooltip } from '../ui/Tooltip';

interface DetailChromeProps {
  icon: string;
  tone?: string;
  title: string;
  url: string;
  tabs: ReactNode;
  /** Actions specific to what is open, placed before the standard three. */
  actions?: ReactNode;
  busy: boolean;
  onRefresh: () => void;
  /** Defaults to plain "Refresh" until a caller has checked what is pending. */
  refreshTip?: string;
  onRefreshHover?: () => void;
  onClose: () => void;
}

/**
 * The bar above whatever is open. The title doubles as the way back, rather
 * than a fourth button beside the other three.
 */
export function DetailChrome({
  icon,
  tone,
  title,
  url,
  tabs,
  actions,
  busy,
  onRefresh,
  refreshTip,
  onRefreshHover,
  onClose,
}: DetailChromeProps) {
  const sidebarCollapsed = useGithubStore((s) => s.sidebarCollapsed);

  return (
    // Raised so the ledge shadow, which falls outside this box, is not painted
    // over by the sticky file header below it.
    <header className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-3 px-3">
      {/* Here rather than on the divider: the panel frame's direct children all
          share a stacking level, so anything between two lands under the later
          one. */}
      <SidebarToggle
        collapsed={sidebarCollapsed}
        onCollapsedChange={(collapsed) => useGithubStore.getState().setSidebarCollapsed(collapsed)}
        hideLabel="Hide the list"
        showLabel="Show the list"
        className="-ml-1"
      />
      <button
        type="button"
        className="flex items-center gap-2 min-w-0 max-w-[min(45%,720px)] text-text-secondary hover:text-text-primary transition-colors duration-150"
        title={title}
        onClick={onClose}
      >
        <Icon name={icon} className={`w-4 h-4 shrink-0 ${tone ?? ''}`} />
        <span className="truncate text-[15px]">{title}</span>
      </button>

      {tabs}

      <div className="flex items-center gap-1 shrink-0">
        {actions}
        {/* Fires on tooltip open, not on hover: the tooltip's delay debounces
            it, so a mouse crossing the bar asks GitHub nothing. */}
        <Tooltip
          text={refreshTip ?? 'Refresh'}
          delay={250}
          onHoverChange={(hovering) => hovering && onRefreshHover?.()}
        >
          <RefreshButton busy={busy} onClick={onRefresh} title="" />
        </Tooltip>
        <IconButton icon="arrow-square-out" label="Open on GitHub" onClick={() => void window.api.openExternal(url)} />
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
    </header>
  );
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        aria-label={label}
        className="w-7 h-7 rounded-md text-text-tertiary flex items-center justify-center hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
        onClick={onClick}
      >
        <Icon name={icon} className="w-4 h-4" />
      </button>
    </Tooltip>
  );
}
