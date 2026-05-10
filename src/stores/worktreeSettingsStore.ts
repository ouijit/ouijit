import { create } from 'zustand';
import log from 'electron-log/renderer';

const worktreeSettingsLog = log.scope('worktreeSettings');

export type WorktreeMode = 'quick-start' | 'clean-checkout';

export const DEFAULT_MODE: WorktreeMode = 'quick-start';

interface WorktreeSettings {
  mode: WorktreeMode;
}

const DEFAULT_SETTINGS: WorktreeSettings = {
  mode: DEFAULT_MODE,
};

interface WorktreeSettingsStoreState {
  settingsByProject: Record<string, WorktreeSettings>;
}

interface WorktreeSettingsStoreActions {
  loadFor: (projectPath: string) => Promise<void>;
  setMode: (projectPath: string, mode: WorktreeMode) => Promise<void>;
  getMode: (projectPath: string) => WorktreeMode;
}

type WorktreeSettingsStore = WorktreeSettingsStoreState & WorktreeSettingsStoreActions;

function storageKey(projectPath: string): string {
  return 'worktree:' + projectPath;
}

function isWorktreeMode(value: unknown): value is WorktreeMode {
  return value === 'quick-start' || value === 'clean-checkout';
}

export const useWorktreeSettingsStore = create<WorktreeSettingsStore>()((set, get) => ({
  settingsByProject: {},

  getMode: (projectPath) => get().settingsByProject[projectPath]?.mode ?? DEFAULT_MODE,

  loadFor: async (projectPath) => {
    try {
      const json = await window.api.globalSettings.get(storageKey(projectPath));
      const parsed = json ? (JSON.parse(json) as { mode?: unknown }) : {};
      const mode = isWorktreeMode(parsed.mode) ? parsed.mode : DEFAULT_MODE;
      set((s) => ({
        settingsByProject: { ...s.settingsByProject, [projectPath]: { mode } },
      }));
    } catch (error) {
      worktreeSettingsLog.error('failed to load settings', {
        projectPath,
        error: error instanceof Error ? error.message : String(error),
      });
      set((s) => ({
        settingsByProject: { ...s.settingsByProject, [projectPath]: { ...DEFAULT_SETTINGS } },
      }));
    }
  },

  setMode: async (projectPath, mode) => {
    set((s) => ({
      settingsByProject: { ...s.settingsByProject, [projectPath]: { mode } },
    }));
    try {
      await window.api.globalSettings.set(storageKey(projectPath), JSON.stringify({ mode }));
    } catch (error) {
      worktreeSettingsLog.error('failed to persist mode', {
        projectPath,
        mode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
