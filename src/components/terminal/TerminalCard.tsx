import { memo, useCallback, useMemo } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE } from '../../stores/terminalStore';
import { terminalInstances } from './terminalReact';
import { spawnRunner } from './terminalActions';
import { TerminalHeader } from './TerminalHeader';
import { XTermContainer } from './XTermContainer';
import { RunnerPanel } from './RunnerPanel';
import { DiffPanel } from '../diff/DiffPanel';

const EMPTY: string[] = [];

interface TerminalCardProps {
  ptyId: string;
  projectPath: string;
}

export const TerminalCard = memo(function TerminalCard({ ptyId, projectPath }: TerminalCardProps) {
  const terminals = useTerminalStore((s) => s.terminalsByProject[projectPath]) ?? EMPTY;
  const activeIndex = useTerminalStore((s) => s.activeIndices[projectPath] ?? 0);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);
  const runnerFullWidth = useTerminalStore((s) => s.displayStates[ptyId]?.runnerFullWidth ?? true);
  const diffPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.diffPanelOpen ?? false);

  const index = terminals.indexOf(ptyId);
  const page = Math.floor(activeIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, terminals.length);
  const pageSize = pageEnd - pageStart;
  const isActive = index === activeIndex;

  const cardClass = useMemo(() => {
    let cls = 'project-card';
    if (index < pageStart || index >= pageEnd) return `${cls} project-card--hidden`;
    if (isActive) cls += ' project-card--active';
    else {
      const diff =
        index < activeIndex ? activeIndex - index : pageSize - (index - pageStart) + (activeIndex - pageStart);
      cls += ` project-card--back-${Math.min(diff, 4)}`;
    }
    if (diffPanelOpen) cls += ' diff-panel-open';
    return cls;
  }, [index, activeIndex, pageStart, pageEnd, pageSize, isActive, diffPanelOpen]);

  const stackPosition = useMemo(() => {
    if (isActive || index < pageStart || index >= pageEnd) return undefined;

    const backPositions: { idx: number; diff: number }[] = [];
    for (let i = pageStart; i < pageEnd; i++) {
      if (i !== activeIndex) {
        const diff = i < activeIndex ? activeIndex - i : pageSize - (i - pageStart) + (activeIndex - pageStart);
        backPositions.push({ idx: i, diff });
      }
    }
    backPositions.sort((a, b) => b.diff - a.diff);
    const pos = backPositions.findIndex((bp) => bp.idx === index);
    return pos !== -1 ? pos + 1 : undefined;
  }, [index, activeIndex, pageStart, pageEnd, pageSize, isActive]);

  const handleClick = useCallback(() => {
    if (!isActive) {
      useTerminalStore.getState().setActiveIndex(projectPath, index);
    }
  }, [isActive, projectPath, index]);

  const handleClose = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (instance) {
      instance.dispose();
    }
    useTerminalStore.getState().removeTerminal(ptyId);
  }, [ptyId]);

  const handleToggleDiffPanel = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.diffPanelOpen = !instance.diffPanelOpen;
    // Close runner panel if opening diff (mutual exclusivity)
    if (instance.diffPanelOpen && instance.runnerPanelOpen) {
      instance.runnerPanelOpen = false;
      instance.pushDisplayState({ diffPanelOpen: true, runnerPanelOpen: false });
    } else {
      instance.pushDisplayState({ diffPanelOpen: instance.diffPanelOpen });
    }
    // Refit terminal after diff panel closes
    if (!instance.diffPanelOpen) {
      requestAnimationFrame(() => instance.fit());
    }
  }, [ptyId]);

  const handleCloseDiffPanel = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.diffPanelOpen = false;
    instance.pushDisplayState({ diffPanelOpen: false });
    requestAnimationFrame(() => instance.fit());
  }, [ptyId]);

  const handleToggleRunner = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;

    if (instance.runner?.ptyId) {
      instance.runnerPanelOpen = !instance.runnerPanelOpen;
      if (instance.runnerPanelOpen && instance.diffPanelOpen) {
        instance.diffPanelOpen = false;
        instance.pushDisplayState({ runnerPanelOpen: true, diffPanelOpen: false });
      } else {
        instance.pushDisplayState({ runnerPanelOpen: instance.runnerPanelOpen });
      }
    } else {
      spawnRunner(ptyId);
    }
  }, [ptyId]);

  const handleCollapseRunner = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.runnerPanelOpen = false;
    instance.pushDisplayState({ runnerPanelOpen: false });
  }, [ptyId]);

  const handleKillRunner = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.killRunner();
    requestAnimationFrame(() => instance.fit());
  }, [ptyId]);

  const handleRestartRunner = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.killRunner();
  }, [ptyId]);

  const bodyClass = useMemo(() => {
    const classes = ['project-card-body'];
    if (runnerPanelOpen) {
      classes.push('runner-split');
      if (runnerFullWidth) classes.push('runner-full');
    }
    return classes.join(' ');
  }, [runnerPanelOpen, runnerFullWidth]);

  return (
    <div className={cardClass} data-pty-id={ptyId} onClick={handleClick}>
      <TerminalHeader
        ptyId={ptyId}
        isActive={isActive}
        stackPosition={stackPosition}
        onClose={handleClose}
        onToggleDiffPanel={handleToggleDiffPanel}
        onToggleRunner={handleToggleRunner}
      />
      <div className={bodyClass}>
        {diffPanelOpen ? (
          <DiffPanel ptyId={ptyId} projectPath={projectPath} onClose={handleCloseDiffPanel} />
        ) : (
          <>
            <XTermContainer ptyId={ptyId} />
            {runnerPanelOpen && (
              <RunnerPanel
                ptyId={ptyId}
                onCollapse={handleCollapseRunner}
                onKill={handleKillRunner}
                onRestart={handleRestartRunner}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});
