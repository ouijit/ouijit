import { useTerminalStore } from '../../stores/terminalStore';
import { XTermContainer } from './XTermContainer';
import { RunnerPanel } from './RunnerPanel';
import { DiffPanel } from '../diff/DiffPanel';
import { PlanPanel } from '../plan/PlanPanel';

interface TerminalBodyProps {
  ptyId: string;
  projectPath: string;
  onCloseDiffPanel: () => void;
  onClosePlanPanel: () => void;
  onCollapseRunner: () => void;
  onKillRunner: () => void;
  onRestartRunner: () => void;
}

export function TerminalBody({
  ptyId,
  projectPath,
  onCloseDiffPanel,
  onClosePlanPanel,
  onCollapseRunner,
  onKillRunner,
  onRestartRunner,
}: TerminalBodyProps) {
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);
  const planPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.planPanelOpen ?? false);
  const planPath = useTerminalStore((s) => s.displayStates[ptyId]?.planPath ?? null);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const runnerFullWidth = useTerminalStore((s) => s.displayStates[ptyId]?.runnerFullWidth ?? true);

  return (
    <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
      {planPanelOpen && planPath ? (
        <PlanPanel ptyId={ptyId} planPath={planPath} onClose={onClosePlanPanel} />
      ) : diffPanelOpen ? (
        <DiffPanel ptyId={ptyId} projectPath={projectPath} onClose={onCloseDiffPanel} />
      ) : (
        <>
          {!(runnerPanelOpen && runnerFullWidth) && (
            <XTermContainer
              ptyId={ptyId}
              className="terminal-xterm-container flex-1 min-h-0 min-w-0 rounded-none border-none pt-4 pl-4 pr-2 pb-2 overflow-hidden"
              style={{
                transition: 'flex 0.25s ease',
                ...(runnerPanelOpen && !runnerFullWidth ? { minWidth: 200 } : {}),
                background: 'var(--color-terminal-bg, #171717)',
              }}
            />
          )}
          {runnerPanelOpen && (
            <RunnerPanel
              ptyId={ptyId}
              onCollapse={onCollapseRunner}
              onKill={onKillRunner}
              onRestart={onRestartRunner}
            />
          )}
        </>
      )}
    </div>
  );
}
