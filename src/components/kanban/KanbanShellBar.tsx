import { useShallow } from 'zustand/react/shallow';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { StatusDot } from '../terminal/StatusDot';
import { Icon } from '../terminal/Icon';

interface KanbanShellBarProps {
  projectPath: string;
  /** Switch to the given terminal and reveal the terminal view. */
  onSwitchToTerminal: (ptyId: string) => void;
}

/**
 * Footer strip on the kanban board that surfaces non-task interactive shells
 * (terminals with `taskId === null`). The board otherwise only renders task
 * columns, so standalone shells opened via Cmd+I are invisible while the board
 * is up — disorienting when you've left a shell running. Each shell is a chip
 * that switches to it. Renders nothing when there are no standalone shells.
 */
export function KanbanShellBar({ projectPath, onSwitchToTerminal }: KanbanShellBarProps) {
  // Mirror KanbanCard's selector shape: return the live display objects (stable
  // references) so useShallow can skip re-renders when unrelated terminals change.
  const shells = useTerminalStore(
    useShallow((s) => {
      const ids = s.terminalsByProject[projectPath] ?? [];
      const result: TerminalDisplayState[] = [];
      for (const ptyId of ids) {
        const d = s.displayStates[ptyId];
        if (d && d.taskId === null && !d.isLoading) result.push(d);
      }
      return result;
    }),
  );

  if (shells.length === 0) return null;

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-2 overflow-x-auto"
      style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
    >
      <span className="flex items-center gap-1.5 shrink-0 text-text-tertiary [&>svg]:w-3.5 [&>svg]:h-3.5">
        <Icon name="terminal" />
        <span className="font-mono text-[11px] uppercase tracking-wide">Shells</span>
      </span>
      <div className="flex items-center gap-1.5 min-w-0">
        {shells.map((shell) => {
          const name = shell.lastOscTitle || shell.label || 'Shell';
          return (
            <button
              key={shell.ptyId}
              className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-full border-none bg-white/[0.06] hover:bg-white/[0.1] active:bg-white/[0.04] transition-colors duration-100 [-webkit-app-region:no-drag] max-w-[200px]"
              onClick={() => onSwitchToTerminal(shell.ptyId)}
            >
              <StatusDot summaryType={shell.summaryType} sandboxed={shell.sandboxed} />
              <span className="font-mono text-[11px] leading-none text-text-secondary truncate min-w-0">
                {name}
                {shell.sandboxed ? ' (sandbox)' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
