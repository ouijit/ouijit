import { useTerminalStore } from '../../stores/terminalStore';
import { XTermContainer } from './XTermContainer';
import { RunnerPanel } from './RunnerPanel';
import { DiffPanel } from '../diff/DiffPanel';
import { PlanPanel } from '../plan/PlanPanel';
import { WebPreviewPanel } from '../webPreview/WebPreviewPanel';

interface TerminalBodyProps {
  ptyId: string;
  projectPath: string;
  onCloseDiffPanel: () => void;
  onClosePlanPanel: () => void;
  onChangePlanFile: (newPath: string) => void;
  onCloseWebPreviewPanel: () => void;
  onChangeWebPreviewUrl: (newUrl: string) => void;
  onCollapseRunner: () => void;
  onKillRunner: () => void;
  onRestartRunner: () => void;
}

export function TerminalBody({
  ptyId,
  projectPath,
  onCloseDiffPanel,
  onClosePlanPanel,
  onChangePlanFile,
  onCloseWebPreviewPanel,
  onChangeWebPreviewUrl,
  onCollapseRunner,
  onKillRunner,
  onRestartRunner,
}: TerminalBodyProps) {
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);
  const planPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.planPanelOpen ?? false);
  const planPath = useTerminalStore((s) => s.displayStates[ptyId]?.planPath ?? null);
  const planFullWidth = useTerminalStore((s) => s.displayStates[ptyId]?.planFullWidth ?? true);
  const webPreviewPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.webPreviewPanelOpen ?? false);
  const webPreviewUrl = useTerminalStore((s) => s.displayStates[ptyId]?.webPreviewUrl ?? null);
  const webPreviewFullWidth = useTerminalStore((s) => s.displayStates[ptyId]?.webPreviewFullWidth ?? true);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const runnerFullWidth = useTerminalStore((s) => s.displayStates[ptyId]?.runnerFullWidth ?? true);

  return (
    <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
      {webPreviewPanelOpen && webPreviewUrl ? (
        <>
          {!webPreviewFullWidth && (
            <XTermContainer
              ptyId={ptyId}
              className="terminal-xterm-container flex-1 min-h-0 min-w-0 rounded-none border-none pt-4 pl-4 pr-2 pb-2 overflow-hidden"
              style={{
                transition: 'flex 0.25s ease',
                minWidth: 200,
                background: 'var(--color-terminal-bg, #171717)',
              }}
            />
          )}
          <WebPreviewPanel
            ptyId={ptyId}
            url={webPreviewUrl}
            onClose={onCloseWebPreviewPanel}
            onChangeUrl={onChangeWebPreviewUrl}
          />
        </>
      ) : planPanelOpen && planPath ? (
        <>
          {!planFullWidth && (
            <XTermContainer
              ptyId={ptyId}
              className="terminal-xterm-container flex-1 min-h-0 min-w-0 rounded-none border-none pt-4 pl-4 pr-2 pb-2 overflow-hidden"
              style={{
                transition: 'flex 0.25s ease',
                minWidth: 200,
                background: 'var(--color-terminal-bg, #171717)',
              }}
            />
          )}
          <PlanPanel ptyId={ptyId} planPath={planPath} onClose={onClosePlanPanel} onChangePlanFile={onChangePlanFile} />
        </>
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
