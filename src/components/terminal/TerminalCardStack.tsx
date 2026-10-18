import { useEffect, useState } from 'react';
import { useTerminalStore, useTagFilter, useVisibleStack } from '../../stores/terminalStore';
import { TerminalCard } from './TerminalCard';
import { stackWindow, turnPage, type StackWindow } from './stackWindow';
import { setStackPositions } from './stackPositions';
import { useViewKeys } from './terminalShortcuts';

const isMac = navigator.platform.toLowerCase().includes('mac');

interface TerminalCardStackProps {
  projectPath: string;
}

export function TerminalCardStack({ projectPath }: TerminalCardStackProps) {
  const visible = useVisibleStack(projectPath);
  const memberCount = useTerminalStore((s) => s.terminalsByProject[projectPath]?.length ?? 0);
  const tagFilter = useTagFilter(projectPath);
  const activeId = visible[0];

  // A page asked for by hand, until the active terminal changes.
  const [page, setPage] = useState<{ page: number; activeId: string | undefined } | null>(null);
  const shown = stackWindow(visible, activeId, page && page.activeId === activeId ? page.page : null);
  const backCards = shown.ids.slice(1);

  useEffect(() => {
    setStackPositions([...backCards].reverse());
    return () => setStackPositions([]);
  });

  useViewKeys({
    arrowleft: (e) => e.shiftKey && pageTo(shown, -1, activeId, setPage),
    arrowright: (e) => e.shiftKey && pageTo(shown, 1, activeId, setPage),
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

      {shown.ids.map((ptyId, depth) => (
        <TerminalCard
          key={ptyId}
          ptyId={ptyId}
          depth={depth}
          stackPosition={depth === 0 ? undefined : backCards.length - depth + 1}
        />
      ))}

      {shown.pageCount > 1 && (
        <Pagination shown={shown} onTurn={(direction) => pageTo(shown, direction, activeId, setPage)} />
      )}
    </div>
  );
}

function pageTo(
  shown: StackWindow,
  direction: -1 | 1,
  activeId: string | undefined,
  setPage: (page: { page: number; activeId: string | undefined }) => void,
): boolean {
  const next = turnPage(shown, direction);
  if (next == null) return false;
  setPage({ page: next, activeId });
  return true;
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

// ── Pagination ───────────────────────────────────────────────────────

function Pagination({ shown, onTurn }: { shown: StackWindow; onTurn: (direction: -1 | 1) => void }) {
  const { page, pageCount: totalPages } = shown;

  return (
    <div
      className="project-stack-pagination fixed z-[150] flex items-center gap-1.5"
      style={{
        top: 58,
        left: 'calc(var(--sidebar-offset, 0px) + (100% - var(--sidebar-offset, 0px)) / 2)',
        transition: 'left 0.2s ease-out',
        transform: 'translateX(-50%)',
      }}
    >
      <button
        className="w-6 h-6 flex items-center justify-center bg-transparent border-none rounded text-ink/35 transition-colors duration-150 ease-out hover:text-ink/70"
        style={{ visibility: page > 0 ? 'visible' : 'hidden' }}
        onClick={(e) => {
          e.stopPropagation();
          onTurn(-1);
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="project-stack-page-indicator text-xs font-mono text-ink/35">
        {page + 1} / {totalPages}
      </span>
      <button
        className="w-6 h-6 flex items-center justify-center bg-transparent border-none rounded text-ink/35 transition-colors duration-150 ease-out hover:text-ink/70"
        style={{ visibility: page < totalPages - 1 ? 'visible' : 'hidden' }}
        onClick={(e) => {
          e.stopPropagation();
          onTurn(1);
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
