import { useEffect } from 'react';
import { useTerminalStore, useTagFilter, useViewedStack, useVisibleStack } from '../../stores/terminalStore';
import { TerminalCard } from './TerminalCard';
import { setStackPositions } from './stackPositions';

const isMac = navigator.platform.toLowerCase().includes('mac');

interface TerminalCardStackProps {
  projectPath: string;
}

export function TerminalCardStack({ projectPath }: TerminalCardStackProps) {
  const visible = useVisibleStack(projectPath);
  const memberCount = useTerminalStore((s) => s.terminalsByProject[projectPath]?.length ?? 0);
  const tagFilter = useTagFilter(projectPath);
  const backCards = visible.slice(1);
  useViewedStack(projectPath);

  useEffect(() => {
    setStackPositions([...backCards].reverse());
    return () => setStackPositions([]);
  });

  const stackTop = 82 + backCards.length * 24;
  const isEmpty = memberCount === 0;
  const isFilteredEmpty = !isEmpty && tagFilter != null && visible.length === 0;

  return (
    <div
      className="fixed right-4 bottom-4 z-[100] overflow-visible"
      style={{
        top: `${stackTop}px`,
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        transition: 'left 0.2s ease-out, right 0.25s ease, top 0.2s ease',
      }}
    >
      {isEmpty && <EmptyState />}
      {isFilteredEmpty && tagFilter && (
        <FilteredEmptyState
          tag={tagFilter}
          onClear={() => useTerminalStore.getState().setTagFilter(projectPath, null)}
        />
      )}

      {visible.map((ptyId, depth) => (
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

// ── Filtered empty state ─────────────────────────────────────────────

export function FilteredEmptyState({ tag, onClear }: { tag: string; onClear: () => void }) {
  return (
    <div
      className="project-stack-empty project-stack-empty--visible absolute inset-0 flex flex-col items-center justify-center text-center rounded-[14px] border border-dashed border-ink/10 p-12 opacity-100"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      <div className="text-sm text-ink/30">No sessions tagged “{tag}”</div>
      <button
        className="mt-4 px-3 py-1.5 text-xs rounded-[10px] border border-bezel text-text-secondary transition-colors duration-150 hover:text-text-primary hover:bg-background-tertiary"
        onClick={onClear}
      >
        Clear filter
      </button>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="project-stack-empty project-stack-empty--visible absolute inset-0 flex flex-col items-center justify-center text-center rounded-[14px] border border-dashed border-ink/10 p-12 opacity-100"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      <div className="text-sm text-ink/30">No active terminals</div>
      <div className="flex justify-center gap-6 mt-6">
        <span
          className="flex items-center gap-1.5"
          style={{ fontSize: 'var(--font-size-xs)', color: 'color-mix(in srgb, var(--color-ink) 35%, transparent)' }}
        >
          <span
            className="inline-flex items-center font-mono"
            style={{ fontSize: 16, color: 'color-mix(in srgb, var(--color-ink) 25%, transparent)' }}
          >
            {isMac ? '⌘' : '⌃'}
            <span className="text-xs">N</span>
          </span>
          New Task
        </span>
        <span
          className="flex items-center gap-1.5"
          style={{ fontSize: 'var(--font-size-xs)', color: 'color-mix(in srgb, var(--color-ink) 35%, transparent)' }}
        >
          <span
            className="inline-flex items-center font-mono"
            style={{ fontSize: 16, color: 'color-mix(in srgb, var(--color-ink) 25%, transparent)' }}
          >
            {isMac ? '⌘' : '⌃'}
            <span className="text-xs">T</span>
          </span>
          Board
        </span>
      </div>
    </div>
  );
}
