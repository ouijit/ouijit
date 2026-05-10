import { memo, useCallback, useMemo, useState } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE } from '../../stores/terminalStore';
import { terminalInstances } from './terminalReact';
import { TerminalHeader } from './TerminalHeader';
import { TerminalBody } from './TerminalBody';
import { TerminalCardView } from './TerminalCardView';
import { useTerminalPanels } from './useTerminalPanels';

const EMPTY: string[] = [];

interface TerminalCardProps {
  ptyId: string;
  projectPath: string;
}

export const TerminalCard = memo(function TerminalCard({ ptyId, projectPath }: TerminalCardProps) {
  const terminals = useTerminalStore((s) => s.terminalsByProject[projectPath]) ?? EMPTY;
  const activeIndex = useTerminalStore((s) => s.activeIndices[projectPath] ?? 0);
  const isLoading = useTerminalStore((s) => s.displayStates[ptyId]?.isLoading ?? false);
  const loadingLabel = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');

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

  const hoverLift = !isActive && hovered ? 4 : 0;

  return (
    <TerminalCardView
      isActive={isActive}
      backDepth={backDepth}
      hoverLift={hoverLift}
      ptyId={ptyId}
      onClick={handleClick}
      onMouseEnter={() => !isActive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isLoading ? (
        <LoadingContents label={loadingLabel || 'New task'} isActive={isActive} />
      ) : (
        <>
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
          {isActive && (
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
          )}
        </>
      )}
    </TerminalCardView>
  );
});

function LoadingContents({ label, isActive }: { label: string; isActive: boolean }) {
  return (
    <>
      <div className="flex items-center justify-between pl-3 pr-3 py-2 min-h-9">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full bg-transparent border-[1.5px] border-white/30 border-t-white/80 shrink-0"
            style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
          />
          <span className="font-mono text-xs font-medium text-white/85 truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 justify-end" />
      </div>
      {isActive && (
        <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="font-mono text-sm text-white/40">Setting up workspace{'…'}</div>
          </div>
        </div>
      )}
    </>
  );
}
