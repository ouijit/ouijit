import { memo, useCallback, useMemo, useState } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE } from '../../stores/terminalStore';
import { terminalInstances } from './terminalReact';
import { TerminalHeader } from './TerminalHeader';
import { TerminalBody } from './TerminalBody';
import { useTerminalPanels } from './useTerminalPanels';

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

  const index = terminals.indexOf(ptyId);
  const page = Math.floor(activeIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, terminals.length);
  const pageSize = pageEnd - pageStart;
  const isActive = index === activeIndex;

  const isHidden = index < pageStart || index >= pageEnd;

  const {
    toggleDiffPanel,
    closeDiffPanel,
    toggleRunner,
    collapseRunner,
    killRunner,
    restartRunner,
    togglePlanPanel,
    closePlanPanel,
    changePlanFile,
    toggleWebPreviewPanel,
    closeWebPreviewPanel,
    changeWebPreviewUrl,
  } = useTerminalPanels(ptyId);

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
      className={`project-card glass-bevel absolute inset-0 rounded-[14px] border border-black/60 overflow-hidden flex flex-col ${isActive ? 'project-card--active' : 'hover:border-accent'}`}
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
        onToggleDiffPanel={toggleDiffPanel}
        onTogglePlanPanel={togglePlanPanel}
        onToggleWebPreviewPanel={toggleWebPreviewPanel}
        onToggleRunner={toggleRunner}
      />
      <TerminalBody
        ptyId={ptyId}
        projectPath={projectPath}
        onCloseDiffPanel={closeDiffPanel}
        onClosePlanPanel={closePlanPanel}
        onChangePlanFile={changePlanFile}
        onCloseWebPreviewPanel={closeWebPreviewPanel}
        onChangeWebPreviewUrl={changeWebPreviewUrl}
        onCollapseRunner={collapseRunner}
        onKillRunner={killRunner}
        onRestartRunner={restartRunner}
      />
    </div>
  );
});
