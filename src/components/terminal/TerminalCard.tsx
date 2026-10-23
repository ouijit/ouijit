import { memo, useCallback, useEffect, useState } from 'react';
import { activateTerminal, useTerminalStore } from '../../stores/terminalStore';
import { closeProjectTerminal } from './terminalActions';
import { terminalInstances } from './terminalRegistry';
import { TerminalHeader } from './TerminalHeader';
import { TerminalBody } from './TerminalBody';
import { TerminalCardView } from './TerminalCardView';
import { pointKey } from '../point/pointKeys';

interface TerminalCardProps {
  ptyId: string;
  /** 0 for the card in front, otherwise how many places behind it. */
  depth: number;
  /** Its ⌘ number, for a back card. */
  stackPosition?: number;
}

export const TerminalCard = memo(function TerminalCard({ ptyId, depth, stackPosition }: TerminalCardProps) {
  const isLoading = useTerminalStore((s) => s.displayStates[ptyId]?.isLoading ?? false);
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? '');
  const projectPath = useTerminalStore((s) => s.displayStates[ptyId]?.projectPath ?? '');
  const taskId = useTerminalStore((s) => s.displayStates[ptyId]?.taskId ?? null);
  const isFront = depth === 0;
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!isFront || isLoading) return;
    const frame = requestAnimationFrame(() => {
      const instance = terminalInstances.get(ptyId);
      instance?.fit();
      instance?.xterm.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isFront, isLoading, ptyId]);

  const handleClick = useCallback(() => activateTerminal(ptyId), [ptyId]);

  const handleClose = useCallback(() => closeProjectTerminal(ptyId), [ptyId]);

  return (
    <TerminalCardView
      isActive={isFront}
      backDepth={depth}
      hoverLift={!isFront && hovered ? 4 : 0}
      ptyId={ptyId}
      pointTarget={[pointKey.terminal(ptyId), ...(taskId != null ? [pointKey.task(projectPath, taskId)] : [])].join(
        ' ',
      )}
      onClick={handleClick}
      onMouseEnter={() => !isFront && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isLoading ? (
        <LoadingContents label={label || 'New task'} isFront={isFront} />
      ) : (
        <>
          <TerminalHeader
            ptyId={ptyId}
            isActive={isFront}
            isBackCard={!isFront}
            stackPosition={stackPosition}
            onClose={handleClose}
          />
          {isFront && <TerminalBody ptyId={ptyId} projectPath={projectPath} />}
        </>
      )}
    </TerminalCardView>
  );
});

function LoadingContents({ label, isFront }: { label: string; isFront: boolean }) {
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
      {isFront && (
        <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <div className="font-mono text-sm text-ink/40">Setting up workspace{'…'}</div>
          </div>
        </div>
      )}
    </>
  );
}
