import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from './terminalReact';
import { XTermContainer } from './XTermContainer';
import { Icon } from './Icon';
import { Tooltip } from '../ui/Tooltip';
import { FullWidthToggle, MinimizeButton, PanelCloseButton } from './FullWidthToggle';

interface RunnerPanelProps {
  ptyId: string;
  panelId: string;
  onRestart: () => void;
  onKill: () => void;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

export function RunnerPanel({
  ptyId,
  panelId,
  onRestart,
  onKill,
  fullWidth,
  onToggleFullWidth,
  onMinimize,
  onClose,
}: RunnerPanelProps) {
  const panel = useTerminalStore((s) => s.displayStates[ptyId]?.panels.find((p) => p.id === panelId));
  const instance = terminalInstances.get(ptyId);
  const runner = instance?.runnerChildren.get(panelId);
  const runnerPtyId = runner?.ptyId;

  const panelTitle = (panel?.kind === 'runner' ? panel.command || panel.scriptName : null) || 'Runner';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0">
        <span className="text-[13px] text-white/50 truncate flex-1 font-mono">{panelTitle}</span>
        {runnerPtyId && (
          <Tooltip text="Kill">
            <button
              className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/40 shrink-0 transition-all duration-150 ease-out hover:bg-red-500/20 hover:text-[#ff6b6b] [&>svg]:w-3.5 [&>svg]:h-3.5"
              onClick={(e) => {
                e.stopPropagation();
                onKill();
              }}
            >
              <Icon name="prohibit" />
            </button>
          </Tooltip>
        )}
        <Tooltip text="Restart">
          <button
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
            onClick={(e) => {
              e.stopPropagation();
              onRestart();
            }}
          >
            <Icon name="arrow-counter-clockwise" />
          </button>
        </Tooltip>
        <FullWidthToggle fullWidth={fullWidth} onToggle={onToggleFullWidth} />
        <MinimizeButton onMinimize={onMinimize} />
        <PanelCloseButton onClose={onClose} />
      </div>
      <div className="flex-1 overflow-hidden min-h-0 px-3 pb-3">
        {runnerPtyId ? (
          <XTermContainer ptyId={runnerPtyId} className="runner-xterm-container w-full h-full overflow-hidden" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/40">
            <div className="font-mono text-sm">Runner stopped</div>
            <button
              className="px-3 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white/80 text-xs border-none transition-colors flex items-center gap-1.5 [&>svg]:w-3.5 [&>svg]:h-3.5"
              onClick={(e) => {
                e.stopPropagation();
                onRestart();
              }}
            >
              <Icon name="arrow-counter-clockwise" />
              Restart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
