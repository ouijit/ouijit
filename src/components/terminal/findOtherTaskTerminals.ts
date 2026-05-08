import type { TerminalDisplayState } from '../../stores/terminalStore';

/**
 * Returns ptyIds of terminals connected to `taskId` in `projectPath`,
 * excluding `excludePtyId` and any terminals still loading. Pure over
 * the passed snapshots so it's easy to unit-test.
 */
export function findOtherTaskTerminals(
  terminalsByProject: Record<string, string[]>,
  displayStates: Record<string, TerminalDisplayState>,
  projectPath: string,
  taskId: number,
  excludePtyId: string,
): string[] {
  const projectPtyIds = terminalsByProject[projectPath] ?? [];
  return projectPtyIds.filter((id) => {
    if (id === excludePtyId) return false;
    const d = displayStates[id];
    return d != null && d.taskId === taskId && !d.isLoading;
  });
}
