import { Icon } from './Icon';
import { Tooltip } from '../ui/Tooltip';

/** Panel-level toggle between full-width and split-with-terminal layout. */
export function FullWidthToggle({ fullWidth, onToggle }: { fullWidth: boolean; onToggle: () => void }) {
  return (
    <Tooltip text={fullWidth ? 'Split view' : 'Full width'}>
      <button
        className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
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
