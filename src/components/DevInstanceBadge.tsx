import { useEffect } from 'react';
import { Tooltip } from './ui/Tooltip';

// typeof guard: the define only exists in Vite-built bundles, not in vitest.
const worktreePath = typeof __DEV_WORKTREE_PATH__ === 'string' ? __DEV_WORKTREE_PATH__ : null;
const worktreeName = worktreePath?.split('/').pop() ?? null;

/**
 * Dev-only titlebar pill identifying which worktree (and dev server port) a
 * running dev instance belongs to, so parallel `npm start` instances are
 * distinguishable. Renders nothing in production builds.
 */
export function DevInstanceBadge() {
  useEffect(() => {
    if (worktreeName) {
      document.title = `ouijit dev · ${worktreeName}`;
    }
  }, []);

  if (!worktreePath || !worktreeName) return null;

  const port = window.location.port;

  return (
    <Tooltip text={worktreePath} placement="bottom-end">
      <div className="h-9 px-3 ml-3 flex items-center bg-background-secondary glass-bevel relative border border-black/60 rounded-[14px] font-mono text-[11px] text-text-tertiary whitespace-nowrap [-webkit-app-region:no-drag]">
        {worktreeName}
        {port && <span className="ml-1.5 text-text-secondary">:{port}</span>}
      </div>
    </Tooltip>
  );
}
