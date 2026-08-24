import { memo, useCallback, useMemo, useState } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE } from '../../stores/terminalStore';
import { recordTerminalJump } from '../navigation';
import { terminalInstances } from './terminalReact';
import { TerminalHeader } from './TerminalHeader';
import { TerminalBody } from './TerminalBody';
import { TerminalCardView } from './TerminalCardView';

interface TerminalCardProps {
  ptyId: string;
  projectPath: string;
  /** Ordered visible (tag-filtered) terminals this card belongs to. */
  orderedIds: string[];
  /** The active ptyId within {@link orderedIds}, or null when the list is empty. */
  activeId: string | null;
}

export const TerminalCard = memo(function TerminalCard({
  ptyId,
  projectPath,
  orderedIds,
  activeId,
}: TerminalCardProps) {
  const isLoading = useTerminalStore((s) => s.displayStates[ptyId]?.isLoading ?? false);
  const loadingLabel = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');

  // Position math runs over the visible list; the store's activeIndices stays a
  // full-list index, so clicks map back through terminalsByProject.
  const index = orderedIds.indexOf(ptyId);
  const rawActiveIndex = activeId ? orderedIds.indexOf(activeId) : 0;
  const activeIndex = rawActiveIndex < 0 ? 0 : rawActiveIndex;
  const page = Math.floor(activeIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, orderedIds.length);
  const pageSize = pageEnd - pageStart;
  const isActive = ptyId === activeId;

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
      const fullIdx = useTerminalStore.getState().terminalsByProject[projectPath]?.indexOf(ptyId) ?? -1;
      if (fullIdx >= 0) {
        recordTerminalJump(ptyId);
        useTerminalStore.getState().setActiveIndex(projectPath, fullIdx);
      }
    }
  }, [isActive, projectPath, ptyId]);

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
          />
          {isActive && <TerminalBody ptyId={ptyId} projectPath={projectPath} />}
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
            className="w-2 h-2 rounded-full bg-transparent border-[1.5px] border-ink/30 border-t-ink/80 shrink-0"
            style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
          />
          <span className="font-mono text-xs font-medium text-ink/85 truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 justify-end" />
      </div>
      {isActive && (
        <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="font-mono text-sm text-ink/40">Setting up workspace{'…'}</div>
          </div>
        </div>
      )}
    </>
  );
}
