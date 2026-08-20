import { useShallow } from 'zustand/react/shallow';
import { useTerminalStore, type TerminalDisplayState } from '../../stores/terminalStore';
import { StatusDot, sandboxSuffix } from '../terminal/StatusDot';
import { Icon } from '../terminal/Icon';

interface KanbanShellBarProps {
  projectPath: string;
  onSwitchToTerminal: (ptyId: string) => void;
}

/**
 * Footer strip listing non-task shells (terminals with `taskId === null`). The
 * board renders only task columns, so shells opened via Cmd+I would otherwise
 * be invisible while it is up. Renders nothing when there are none.
 */
export function KanbanShellBar({ projectPath, onSwitchToTerminal }: KanbanShellBarProps) {
  // Return the store's live display objects, whose references are stable, so
  // useShallow can skip re-renders from unrelated terminals.
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
    // Raised so the ledge shadow, which falls outside this box, is not painted
    // over by the card below it.
    <div className="pane-ledge-under relative z-10 shrink-0 flex items-center gap-2 px-3 py-2 overflow-x-auto">
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
              className="group/shell relative flex items-center gap-1.5 shrink-0 h-7 px-2.5 rounded-[12px] bg-background-secondary glass-bevel border border-bezel overflow-hidden text-text-secondary hover:bg-background-tertiary transition-colors duration-150 ease-out [-webkit-app-region:no-drag] max-w-[200px]"
              onClick={() => onSwitchToTerminal(shell.ptyId)}
            >
              <StatusDot summaryType={shell.summaryType} sandboxProvider={shell.sandboxProvider} />
              <span className="font-mono text-[11px] leading-none truncate min-w-0 group-hover/shell:text-text-primary transition-colors duration-150">
                {name}
                {sandboxSuffix(shell.sandboxProvider)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
