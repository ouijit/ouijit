import { Icon } from './Icon';
import { Tooltip } from '../ui/Tooltip';

const PANEL_HEADER_BUTTON =
  'w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5';

/** Panel-level toggle between full-width and split-with-terminal layout. */
export function FullWidthToggle({ fullWidth, onToggle }: { fullWidth: boolean; onToggle: () => void }) {
  return (
    <Tooltip text={fullWidth ? 'Split view' : 'Full width'}>
      <button
        className={PANEL_HEADER_BUTTON}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={fullWidth ? 'Split view' : 'Full width'}
      >
        <Icon name={fullWidth ? 'square-split-horizontal' : 'arrows-out-line-horizontal'} />
      </button>
    </Tooltip>
  );
}

/** Panel-level minimize button — collapses the panel, keeping its tab. */
export function MinimizeButton({ onMinimize }: { onMinimize: () => void }) {
  return (
    <Tooltip text="Minimize">
      <button
        className={PANEL_HEADER_BUTTON}
        onClick={(e) => {
          e.stopPropagation();
          onMinimize();
        }}
        aria-label="Minimize"
      >
        <Icon name="minus" />
      </button>
    </Tooltip>
  );
}

/** Panel-level close button — closes (removes) the panel. */
export function PanelCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Tooltip text="Close panel">
      <button
        className={PANEL_HEADER_BUTTON}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close panel"
      >
        <Icon name="x" />
      </button>
    </Tooltip>
  );
}
