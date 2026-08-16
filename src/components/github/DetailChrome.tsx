import type { ReactNode } from 'react';
import { Icon } from '../terminal/Icon';
import { SidebarToggle } from '../common/SidebarToggle';
import { useGithubStore } from '../../stores/githubStore';
import { RefreshButton } from './RefreshButton';
import { Tooltip } from '../ui/Tooltip';

interface DetailChromeProps {
  icon: string;
  /** Text colour for the state glyph, from the caller's state map. */
  tone?: string;
  title: string;
  /** Opened on GitHub by the external-link button. */
  url: string;
  tabs: ReactNode;
  /** Actions specific to what is open, placed before the standard three. */
  actions?: ReactNode;
  busy: boolean;
  onRefresh: () => void;
  /**
   * What refreshing would do, once something has checked. Plain "Refresh"
   * where nothing has — an issue has no such check, and a pull request has
   * none until the button is pointed at.
   */
  refreshTip?: string;
  /** Pointed at: the moment to find out whether there is anything to pull. */
  onRefreshHover?: () => void;
  onClose: () => void;
}

/**
 * The bar above whatever is open: what it is on the left, the panes centred,
 * the actions on the right.
 *
 * Shared by pull requests and issues. The title doubles as the way back,
 * rather than a fourth button beside the other three.
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
    // Raised: the cut is a shadow falling outside this box, and the first thing
    // at that pixel in the code pane is a sticky file header with an opaque
    // background, which would paint straight over it.
    <header className="pane-ledge relative z-30 shrink-0 h-12 flex items-center gap-3 px-3">
      {/* Here rather than on the divider itself: the panel frame gives every
          one of its direct children the same stacking level, so anything
          floating between two of them ends up under the later one. */}
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
        {/* The check runs when the tooltip opens rather than on the first
            pixel of hover: the tooltip's own delay is the debounce, so a mouse
            crossing the bar on its way somewhere else asks GitHub nothing. */}
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
