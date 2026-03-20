import { useCallback } from 'react';
import { useTerminalStore, STACK_PAGE_SIZE } from '../../stores/terminalStore';
import { TerminalCard } from './TerminalCard';

const isMac = navigator.platform.toLowerCase().includes('mac');
const EMPTY: string[] = [];

interface TerminalCardStackProps {
  projectPath: string;
}

export function TerminalCardStack({ projectPath }: TerminalCardStackProps) {
  const terminals = useTerminalStore((s) => s.terminalsByProject[projectPath]) ?? EMPTY;
  const activeIndex = useTerminalStore((s) => s.activeIndices[projectPath] ?? 0);
  const loadingLabel = useTerminalStore((s) => s.loadingLabel);

  const page = Math.floor(activeIndex / STACK_PAGE_SIZE);
  const pageStart = page * STACK_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + STACK_PAGE_SIZE, terminals.length);
  const pageSize = pageEnd - pageStart;
  const totalPages = Math.max(1, Math.ceil(terminals.length / STACK_PAGE_SIZE));

  // Calculate stack top position based on back card count
  const backCardCount = Math.max(Math.min(pageSize - 1, 4), 0);
  const stackTop = 82 + backCardCount * 24;

  const isEmpty = terminals.length === 0 && !loadingLabel;

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

      {loadingLabel && <LoadingCard label={loadingLabel} />}

      {terminals.map((ptyId) => (
        <TerminalCard key={ptyId} ptyId={ptyId} projectPath={projectPath} />
      ))}

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} projectPath={projectPath} />}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="project-stack-empty project-stack-empty--visible absolute inset-0 flex flex-col items-center justify-center text-center rounded-[14px] border border-dashed border-white/10 p-12 opacity-100"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      <div className="text-sm text-white/30">No active terminals</div>
      <div className="flex justify-center gap-6 mt-6">
        <span
          className="flex items-center gap-1.5"
          style={{ fontSize: 'var(--font-size-xs)', color: 'rgba(255, 255, 255, 0.35)' }}
        >
          <span
            className="inline-flex items-center font-mono"
            style={{ fontSize: isMac ? 16 : 13, color: 'rgba(255, 255, 255, 0.25)' }}
          >
            {isMac ? '\u2318' : 'Ctrl+'}
            <span className={isMac ? 'text-xs' : 'text-[13px]'}>N</span>
          </span>
          New Task
        </span>
        <span
          className="flex items-center gap-1.5"
          style={{ fontSize: 'var(--font-size-xs)', color: 'rgba(255, 255, 255, 0.35)' }}
        >
          <span
            className="inline-flex items-center font-mono"
            style={{ fontSize: isMac ? 16 : 13, color: 'rgba(255, 255, 255, 0.25)' }}
          >
            {isMac ? '\u2318' : 'Ctrl+'}
            <span className={isMac ? 'text-xs' : 'text-[13px]'}>T</span>
          </span>
          Board
        </span>
      </div>
    </div>
  );
}

// ── Loading card ─────────────────────────────────────────────────────

function LoadingCard({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-0 rounded-[14px] border border-white/10 overflow-hidden flex flex-col pointer-events-none z-10"
      style={{ background: 'var(--color-terminal-bg, #171717)' }}
    >
      <div className="flex items-center justify-between pl-3 pr-3 py-2 min-h-9">
        <div className="flex flex-col min-w-0 shrink">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span
              className="w-2 h-2 rounded-full bg-transparent border-[1.5px] border-white/30 border-t-white/80"
              style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
            />
            <span className="font-mono text-xs font-medium text-white/70 shrink-0">{label || 'New task'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 justify-end" />
      </div>
      <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="font-mono text-sm text-white/40">Setting up workspace...</div>
        </div>
      </div>
    </div>
  );
}

// ── Pagination ───────────────────────────────────────────────────────

function Pagination({ page, totalPages, projectPath }: { page: number; totalPages: number; projectPath: string }) {
  const navigatePage = useCallback(
    (direction: -1 | 1) => {
      const targetPage = page + direction;
      if (targetPage < 0 || targetPage >= totalPages) return;
      const targetIndex = targetPage * STACK_PAGE_SIZE;
      useTerminalStore.getState().setActiveIndex(projectPath, targetIndex);
    },
    [page, totalPages, projectPath],
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
        className="w-6 h-6 flex items-center justify-center bg-transparent border-none rounded text-white/35 transition-colors duration-150 ease-out hover:text-white/70"
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
      <span className="project-stack-page-indicator text-xs font-mono text-white/35">
        {page + 1} / {totalPages}
      </span>
      <button
        className="w-6 h-6 flex items-center justify-center bg-transparent border-none rounded text-white/35 transition-colors duration-150 ease-out hover:text-white/70"
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
