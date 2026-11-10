import { create } from 'zustand';
import type { Automation, AutomationRun, AutomationsSnapshot } from '../automations/types';

interface AutomationStoreState {
  /** Every project's automations and runs; small enough to hold whole. */
  snapshot: AutomationsSnapshot | null;
  load: () => Promise<void>;
}

/** Bumped per load so a stale response can't land over a fresher one. */
let version = 0;

export const useAutomationStore = create<AutomationStoreState>()((set) => ({
  snapshot: null,
  load: async () => {
    const mine = ++version;
    const snapshot = await window.api.automations.snapshot();
    if (mine === version) set({ snapshot });
  },
}));

const NO_AUTOMATIONS: Automation[] = [];
const NO_RUNS: AutomationRun[] = [];

export function useProjectAutomations(projectPath: string): { automations: Automation[]; runs: AutomationRun[] } {
  const snapshot = useAutomationStore((s) => s.snapshot);
  const automations = snapshot?.automations.filter((a) => a.projectPath === projectPath) ?? NO_AUTOMATIONS;
  const runs = snapshot?.runs.filter((r) => r.projectPath === projectPath) ?? NO_RUNS;
  return { automations, runs };
}

/** What the sidebar row shows: runs waiting on the user, and whether one is going. */
export function useAutomationBadge(projectPath: string): { unread: number; running: boolean } {
  const unread = useAutomationStore(
    (s) => s.snapshot?.runs.filter((r) => r.projectPath === projectPath && r.unread).length ?? 0,
  );
  const running = useAutomationStore(
    (s) => s.snapshot?.runs.some((r) => r.projectPath === projectPath && r.state === 'running') ?? false,
  );
  return { unread, running };
}

export function installAutomationListener(onShow: (projectPath: string) => void): () => void {
  void useAutomationStore.getState().load();
  const offChanged = window.api.automations.onChanged(() => void useAutomationStore.getState().load());
  const offShow = window.api.automations.onShow(onShow);
  return () => {
    offChanged();
    offShow();
  };
}
