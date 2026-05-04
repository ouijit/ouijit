/**
 * Synthetic stack-slot ids for tasks whose terminal is still being created.
 * Lives in `terminalsByProject` alongside real ptyIds so stack ordering,
 * paging, depth, hover, and click-cycling all work for free. When the real
 * PTY spawns, `rekeyTerminal` swaps the synthetic id for the real one in
 * place — same slot, same active index, no re-mount.
 */

const PREFIX = 'loading:';

export function loadingSlotId(taskNumber: number): string {
  return `${PREFIX}T${taskNumber}`;
}

export function isLoadingId(id: string): boolean {
  return id.startsWith(PREFIX);
}

export function loadingLabelFromId(id: string): string {
  return id.slice(PREFIX.length) || 'New task';
}
