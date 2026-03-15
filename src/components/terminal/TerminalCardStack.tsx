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
    <div className="project-stack" style={{ top: `${stackTop}px` }}>
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
    <div className="project-stack-empty project-stack-empty--visible">
      <div className="project-stack-empty-message">No active terminals</div>
      <div className="project-stack-empty-hints">
        <span className="project-stack-empty-hint">
          <span className="project-stack-empty-hint-shortcut">
            {isMac ? '\u2318' : 'Ctrl+'}
            <span className="shortcut-number">N</span>
          </span>
          New Task
        </span>
        <span className="project-stack-empty-hint">
          <span className="project-stack-empty-hint-shortcut">
            {isMac ? '\u2318' : 'Ctrl+'}
            <span className="shortcut-number">B</span>
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
    <div className="project-card project-card--loading project-card--active">
      <div className="project-card-label">
        <div className="project-card-label-left">
          <div className="project-card-label-top">
            <span className="project-card-status-dot project-card-status-dot--loading" />
            <span className="project-card-label-text">{label || 'New task'}</span>
          </div>
        </div>
        <div className="project-card-label-right" />
      </div>
      <div className="project-card-body">
        <div className="project-card-loading-content">
          <div className="project-card-loading-text">Setting up workspace...</div>
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
    <div className="project-stack-pagination">
      <button
        className="project-stack-page-arrow"
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
      <span className="project-stack-page-indicator">
        {page + 1} / {totalPages}
      </span>
      <button
        className="project-stack-page-arrow"
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
