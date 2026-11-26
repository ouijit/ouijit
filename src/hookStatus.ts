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
  if (status === 'thinking') {
    hookStatusMap.set(ptyId, {
      status: 'thinking',
      thinkingCount: (entry?.thinkingCount ?? 0) + 1,
    });
  } else {
    hookStatusMap.set(ptyId, {
      status: 'ready',
      thinkingCount: entry?.thinkingCount ?? 0,
    });
  }
}

export function clearHookStatus(ptyId: string): void {
  hookStatusMap.delete(ptyId);
}

export function clearAllHookStatuses(): void {
  hookStatusMap.clear();
}
