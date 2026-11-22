import type { ReactNode } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalInstances } from './terminalRegistry';
import { XTermContainer } from './XTermContainer';
import { Icon } from './Icon';
import { Tooltip } from '../ui/Tooltip';

interface RunnerPanelProps {
  ptyId: string;
  panelId: string;
  onRestart: () => void;
  onKill: () => void;
  /** The pane's tab bar, with this panel's own actions in it. */
  bar: (actions: ReactNode) => ReactNode;
}

export function RunnerPanel({ ptyId, panelId, onRestart, onKill, bar }: RunnerPanelProps) {
  const panel = useTerminalStore((s) => s.displayStates[ptyId]?.panels.find((p) => p.id === panelId));
  const instance = terminalInstances.get(ptyId);
  const runner = instance?.runnerChildren.get(panelId);
  const runnerPtyId = runner?.ptyId;
  // The tab names a script by its name; what it runs is said under it.
  const command = panel?.kind === 'runner' && panel.scriptName ? panel.command || panel.scriptCommand : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {bar(
        <>
          {runnerPtyId && (
            <Tooltip text="Kill" keepAxis>
              <button
                className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-ink/40 shrink-0 transition-all duration-150 ease-out hover:bg-error/20 hover:text-ansi-red [&>svg]:w-3.5 [&>svg]:h-3.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onKill();
                }}
              >
                <Icon name="prohibit" />
              </button>
            </Tooltip>
          )}
          <Tooltip text="Restart" keepAxis>
            <button
              className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-ink/60 shrink-0 transition-all duration-150 ease-out hover:bg-ink/10 hover:text-ink/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
              onClick={(e) => {
                e.stopPropagation();
                onRestart();
              }}
            >
              <Icon name="arrow-counter-clockwise" />
            </button>
          </Tooltip>
        </>,
      )}
      {command && (
        <div className="px-4 pb-1.5 shrink-0 text-[12px] text-ink/45 font-mono truncate" title={command}>
          {command}
        </div>
      )}
      <div className="flex-1 overflow-hidden min-h-0 px-3 pb-3">
        {runnerPtyId ? (
          <XTermContainer ptyId={runnerPtyId} className="runner-xterm-container w-full h-full overflow-hidden" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-ink/40">
            <div className="font-mono text-sm">Runner stopped</div>
            <button
              className="px-3 py-1 rounded-md bg-ink/10 hover:bg-ink/15 text-ink/80 text-xs border-none transition-colors flex items-center gap-1.5 [&>svg]:w-3.5 [&>svg]:h-3.5"
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
