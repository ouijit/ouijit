import { Icon } from '../terminal/Icon';

interface SidebarToggleProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  hideLabel?: string;
  showLabel?: string;
  className?: string;
}

/**
 * Puts a sidebar away and brings it back.
 *
 * Belongs to the pane on the right of the divider, not to the sidebar, so that
 * hiding the sidebar cannot take the control with it. Same button as the other
 * icon buttons in that pane's header, because that is what it is — it just
 * happens to be the leftmost one.
 */
export function SidebarToggle({
  collapsed,
  onCollapsedChange,
  hideLabel = 'Hide the sidebar',
  showLabel = 'Show the sidebar',
  className = '',
}: SidebarToggleProps) {
  const label = collapsed ? showLabel : hideLabel;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      className={`w-7 h-7 rounded-md bg-transparent border-none text-ink/60 flex items-center justify-center shrink-0 transition-all duration-150 ease-out hover:bg-ink/10 hover:text-ink/90 ${className}`}
      onClick={() => onCollapsedChange(!collapsed)}
    >
      <Icon name={collapsed ? 'caret-right' : 'caret-left'} />
    </button>
  );
}
