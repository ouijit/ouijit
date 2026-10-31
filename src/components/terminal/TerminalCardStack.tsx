import { useEffect } from 'react';
import { useStack, useViewedStack } from '../../stores/terminalStore';
import { TerminalCard } from './TerminalCard';
import { setStackPositions } from './stackPositions';

export function TerminalCardStack({ stack }: { stack: string }) {
  const members = useStack(stack);
  const backCards = members.slice(1);
  useViewedStack(stack);

  useEffect(() => {
    setStackPositions([...backCards].reverse());
    return () => setStackPositions([]);
  });

  return (
    <div
      className="fixed right-4 bottom-4 z-[100] overflow-visible"
      style={{
        top: `${82 + backCards.length * 24}px`,
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        transition: 'left 0.2s ease-out, right 0.25s ease, top 0.2s ease',
      }}
    >
      {/* Rendered in a fixed order and stacked by z-index: a node React moves
          to match a new order skips its transition and jumps into place. */}
      {members
        .map((ptyId, depth) => ({ ptyId, depth }))
        .sort((a, b) => a.ptyId.localeCompare(b.ptyId))
        .map(({ ptyId, depth }) => (
          <TerminalCard
            key={ptyId}
            ptyId={ptyId}
            depth={depth}
            stackPosition={depth === 0 ? undefined : backCards.length - depth + 1}
          />
        ))}
    </div>
  );
}
