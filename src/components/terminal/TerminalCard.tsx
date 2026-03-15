import { memo, useCallback, useMemo } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE } from '../../stores/terminalStore';
import { terminalInstances } from './terminalReact';
import { TerminalHeader } from './TerminalHeader';
import { XTermContainer } from './XTermContainer';
import { RunnerPanel } from './RunnerPanel';

const EMPTY: string[] = [];

interface TerminalCardProps {
  ptyId: string;
  projectPath: string;
}

export const TerminalCard = memo(function TerminalCard({ ptyId, projectPath }: TerminalCardProps) {
  const terminals = useTerminalStore((s) => s.terminalsByProject[projectPath]) ?? EMPTY;
  const activeIndex = useTerminalStore((s) => s.activeIndices[projectPath] ?? 0);
  const runnerPanelOpen = useTerminalStore((s) => s.displayStates[ptyId]?.runnerPanelOpen ?? false);

  const index = terminals.indexOf(ptyId);
  const page = Math.floor(activeIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, terminals.length);
  const pageSize = pageEnd - pageStart;
  const isActive = index === activeIndex;

  // Calculate stack position class
  const cardClass = useMemo(() => {
    if (index < pageStart || index >= pageEnd) return 'project-card project-card--hidden';
    if (isActive) return 'project-card project-card--active';

    const diff = index < activeIndex ? activeIndex - index : pageSize - (index - pageStart) + (activeIndex - pageStart);
    const backClass = `project-card--back-${Math.min(diff, 4)}`;
    return `project-card ${backClass}`;
  }, [index, activeIndex, pageStart, pageEnd, pageSize, isActive]);

  // Calculate stack position number for keyboard shortcut display
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
    instance.pushDisplayState({ diffPanelOpen: instance.diffPanelOpen });
  }, [ptyId]);

  const handleToggleRunner = useCallback(() => {
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;

    if (instance.runner?.ptyId) {
      instance.runnerPanelOpen = !instance.runnerPanelOpen;
      instance.pushDisplayState({ runnerPanelOpen: instance.runnerPanelOpen });
    }
    // If no runner exists, the parent (ProjectView) handles spawning via runDefaultInCard
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
    // Restart handled by parent — this component just signals intent
    const instance = terminalInstances.get(ptyId);
    if (!instance) return;
    instance.killRunner();
    // Parent will re-trigger runDefaultInCard
  }, [ptyId]);

  const bodyClass = useMemo(() => {
    const classes = ['project-card-body'];
    if (runnerPanelOpen) {
      classes.push('runner-split');
      const instance = terminalInstances.get(ptyId);
      if (instance?.runnerFullWidth) classes.push('runner-full');
    }
    return classes.join(' ');
  }, [runnerPanelOpen, ptyId]);

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
        <XTermContainer ptyId={ptyId} />
        {runnerPanelOpen && (
          <RunnerPanel
            ptyId={ptyId}
            onCollapse={handleCollapseRunner}
            onKill={handleKillRunner}
            onRestart={handleRestartRunner}
          />
        )}
      </div>
    </div>
  );
});
