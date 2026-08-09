import type { ReactNode } from 'react';
import { Icon } from '../terminal/Icon';
import { RefreshButton } from './RefreshButton';

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
  onClose: () => void;
}

/**
 * The bar above whatever is open: what it is on the left, the panes centred,
 * the actions on the right.
 *
 * Shared by pull requests and issues so the two are the same view of different
 * things rather than two views that happen to resemble each other. The title
 * doubles as the way back, since going back is the most common thing to do from
 * a detail view and a dedicated arrow would be a fourth button.
 */
export function DetailChrome({ icon, tone, title, url, tabs, actions, busy, onRefresh, onClose }: DetailChromeProps) {
  return (
    // Extra room on the left for the sidebar toggle, which floats on the
    // resize handle immediately outside this pane.
    <header className="shrink-0 h-12 flex items-center gap-3 pl-7 pr-3 border-b border-ink/[0.06]">
      <button
        type="button"
        className="flex items-center gap-2 min-w-0 max-w-[280px] text-text-secondary hover:text-text-primary transition-colors duration-150"
        title={title}
        onClick={onClose}
      >
        <Icon name={icon} className={`w-4 h-4 shrink-0 ${tone ?? ''}`} />
        <span className="truncate text-[15px]">{title}</span>
      </button>

      {tabs}

      <div className="flex items-center gap-1 shrink-0">
        {actions}
        <RefreshButton busy={busy} onClick={onRefresh} />
        <IconButton icon="arrow-square-out" label="Open on GitHub" onClick={() => void window.api.openExternal(url)} />
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
    </header>
  );
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="w-7 h-7 rounded-md text-text-tertiary flex items-center justify-center hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-150"
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  );
}
