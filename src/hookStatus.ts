/** Agent status reported by hooks, kept in the main process so it survives renderer reloads. */

export type HookStatus = 'thinking' | 'ready';

export interface HookStatusEntry {
  status: HookStatus;
  thinkingCount: number;
}

const hookStatusMap = new Map<string, HookStatusEntry>();

export function getHookStatus(ptyId: string): HookStatusEntry | null {
  return hookStatusMap.get(ptyId) ?? null;
}

export function recordHookStatus(ptyId: string, status: HookStatus): void {
  const entry = hookStatusMap.get(ptyId);
  hookStatusMap.set(ptyId, {
    status,
    thinkingCount: (entry?.thinkingCount ?? 0) + (status === 'thinking' ? 1 : 0),
  });
}

export function clearHookStatus(ptyId: string): void {
  hookStatusMap.delete(ptyId);
}

export function clearAllHookStatuses(): void {
  hookStatusMap.clear();
}
