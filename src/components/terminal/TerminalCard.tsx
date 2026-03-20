import { memo, useCallback, useMemo, useState } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE } from '../../stores/terminalStore';
import { terminalInstances } from './terminalReact';
import { spawnRunner } from './terminalActions';
import { TerminalHeader } from './TerminalHeader';
import { XTermContainer } from './XTermContainer';
import { RunnerPanel } from './RunnerPanel';
import { DiffPanel } from '../diff/DiffPanel';

const EMPTY: string[] = [];

const DEPTH_STYLES: Record<number, React.CSSProperties> = {
  1: {
    zIndex: 9,
    transform: 'translateY(-24px)',
    left: '1%',
    right: '1%',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.12)',
    contain: 'layout style paint',
  },
  2: {
    zIndex: 8,
    transform: 'translateY(-48px)',
    left: '2%',
    right: '2%',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 4px rgba(0, 0, 0, 0.08)',
    contain: 'layout style paint',
  },
  3: {
    zIndex: 7,
    transform: 'translateY(-72px)',
    left: '3%',
    right: '3%',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.08)',
    contain: 'layout style paint',
  },
  4: {
    zIndex: 6,
    transform: 'translateY(-96px)',
    left: '4%',
    right: '4%',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.06)',
    contain: 'layout style paint',
  },
};

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

  const isHidden = index < pageStart || index >= pageEnd;

  const backDepth = useMemo(() => {
    if (isActive || isHidden) return 0;
    const diff = index < activeIndex ? activeIndex - index : pageSize - (index - pageStart) + (activeIndex - pageStart);
    return Math.min(diff, 4);
  }, [index, activeIndex, pageStart, pageSize, isActive, isHidden]);

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

  const [hovered, setHovered] = useState(false);

  if (isHidden) return null;

  const depthBase = DEPTH_STYLES[backDepth];
  const liftPx = !isActive && hovered && depthBase ? backDepth * 24 + 4 : 0;

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-terminal-bg, #171717)',
    transition: 'transform 0.2s ease, left 0.2s ease, right 0.2s ease',
    ...(isActive
      ? {
          zIndex: 10,
          transform: 'none',
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
        }
      : {
          ...depthBase,
          ...(liftPx ? { transform: `translateY(-${liftPx}px)` } : {}),
        }),
  };

  return (
    <div
      className={`absolute inset-0 rounded-[14px] border border-white/10 overflow-hidden flex flex-col ${!isActive ? 'hover:border-accent' : ''}`}
      style={cardStyle}
      onMouseEnter={() => !isActive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-pty-id={ptyId}
      onClick={handleClick}
    >
      <TerminalHeader
        ptyId={ptyId}
        isActive={isActive}
        isBackCard={!isActive}
        stackPosition={stackPosition}
        onClose={handleClose}
        onToggleDiffPanel={handleToggleDiffPanel}
        onToggleRunner={handleToggleRunner}
      />
      <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
        {diffPanelOpen ? (
          <DiffPanel ptyId={ptyId} projectPath={projectPath} onClose={handleCloseDiffPanel} />
        ) : (
          <>
            {!(runnerPanelOpen && runnerFullWidth) && (
              <XTermContainer
                ptyId={ptyId}
                className="terminal-xterm-container flex-1 min-h-0 min-w-0 h-auto rounded-none border-none"
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
