import { useCallback, useEffect } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE, terminalMatchesTag } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { recordTerminalJump } from '../navigation';
import { TerminalCard } from './TerminalCard';

const isMac = navigator.platform.toLowerCase().includes('mac');
const EMPTY: string[] = [];

interface TerminalCardStackProps {
  projectPath: string;
}

export function TerminalCardStack({ projectPath }: TerminalCardStackProps) {
  const terminals = useTerminalStore((s) => s.terminalsByProject[projectPath]) ?? EMPTY;
  const activeIndex = useTerminalStore((s) => s.activeIndices[projectPath] ?? 0);
  const displayStates = useTerminalStore((s) => s.displayStates);
  const tagFilter = useProjectStore((s) => s.tagFilter);

  const visible = tagFilter ? terminals.filter((id) => terminalMatchesTag(displayStates[id], tagFilter)) : terminals;

  // Resolve the active card within the visible list. If the filter hid the
  // store's active terminal, fall back to the front of the visible list.
  const activeFullPtyId = terminals[activeIndex];
  const activeId = activeFullPtyId && visible.includes(activeFullPtyId) ? activeFullPtyId : (visible[0] ?? null);

  // Keep the store's active pointer on a visible terminal so focus, diff, and
  // keyboard nav all target something that's actually on screen.
  useEffect(() => {
    if (!tagFilter || visible.length === 0) return;
    if (activeFullPtyId && visible.includes(activeFullPtyId)) return;
    const fullIdx = terminals.indexOf(visible[0]);
    if (fullIdx >= 0) useTerminalStore.getState().setActiveIndex(projectPath, fullIdx);
  }, [tagFilter, visible, activeFullPtyId, terminals, projectPath]);

  const activeVisibleIndex = Math.max(activeId ? visible.indexOf(activeId) : 0, 0);
  const page = Math.floor(activeVisibleIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, visible.length);
  const pageSize = pageEnd - pageStart;
  const totalPages = Math.max(1, Math.ceil(visible.length / STACK_PAGE_SIZE));

  const backCardCount = Math.max(Math.min(pageSize - 1, 4), 0);
  const stackTop = 82 + backCardCount * 24;

  const isEmpty = terminals.length === 0;
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
        <FilteredEmptyState tag={tagFilter} onClear={() => useProjectStore.getState().setTagFilter(null)} />
      )}

      {visible.map((ptyId) => (
        <TerminalCard key={ptyId} ptyId={ptyId} projectPath={projectPath} orderedIds={visible} activeId={activeId} />
      ))}

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} visible={visible} projectPath={projectPath} />}
    </div>
  );
}

// ── Filtered empty state ─────────────────────────────────────────────

function FilteredEmptyState({ tag, onClear }: { tag: string; onClear: () => void }) {
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

function Pagination({
  page,
  totalPages,
  visible,
  projectPath,
}: {
  page: number;
  totalPages: number;
  visible: string[];
  projectPath: string;
}) {
  const navigatePage = useCallback(
    (direction: -1 | 1) => {
      const targetPage = page + direction;
      if (targetPage < 0 || targetPage >= totalPages) return;
      const ptyId = visible[targetPage * STACK_PAGE_SIZE];
      if (!ptyId) return;
      const fullIdx = useTerminalStore.getState().terminalsByProject[projectPath]?.indexOf(ptyId) ?? -1;
      if (fullIdx >= 0) {
        recordTerminalJump(ptyId);
        useTerminalStore.getState().setActiveIndex(projectPath, fullIdx);
      }
    },
    [page, totalPages, visible, projectPath],
  );

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
          navigatePage(-1);
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
          navigatePage(1);
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
