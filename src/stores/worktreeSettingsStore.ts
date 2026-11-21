import { create } from 'zustand';
import log from 'electron-log/renderer';
import {
  DEFAULT_WORKTREE_SETTINGS,
  parseWorktreeSettings,
  serializeWorktreeSettings,
  worktreeSettingsKey,
  type WorktreeMode,
  type WorktreeSettings,
} from '../worktreeSettings';

export type { WorktreeMode };

const worktreeSettingsLog = log.scope('worktreeSettings');

interface WorktreeSettingsStoreState {
  settingsByProject: Record<string, WorktreeSettings>;
}

interface WorktreeSettingsStoreActions {
  loadFor: (projectPath: string) => Promise<void>;
  setMode: (projectPath: string, mode: WorktreeMode) => Promise<void>;
  setBase: (projectPath: string, base: string | null) => Promise<void>;
  getMode: (projectPath: string) => WorktreeMode;
}

type WorktreeSettingsStore = WorktreeSettingsStoreState & WorktreeSettingsStoreActions;

export const useWorktreeSettingsStore = create<WorktreeSettingsStore>()((set, get) => ({
  settingsByProject: {},

  getMode: (projectPath) => get().settingsByProject[projectPath]?.mode ?? DEFAULT_WORKTREE_SETTINGS.mode,

  loadFor: async (projectPath) => {
    try {
      const settings = parseWorktreeSettings(await window.api.globalSettings.get(worktreeSettingsKey(projectPath)));
      set((s) => ({
        settingsByProject: { ...s.settingsByProject, [projectPath]: settings },
      }));
    } catch (error) {
      worktreeSettingsLog.error('failed to load settings', {
        projectPath,
        error: error instanceof Error ? error.message : String(error),
      });
      set((s) => ({
        settingsByProject: { ...s.settingsByProject, [projectPath]: { ...DEFAULT_WORKTREE_SETTINGS } },
      }));
    }
  },

  setMode: (projectPath, mode) => save(projectPath, { mode }),
  setBase: (projectPath, base) => save(projectPath, { base }),
}));

async function save(projectPath: string, change: Partial<WorktreeSettings>): Promise<void> {
  const settings = {
    ...DEFAULT_WORKTREE_SETTINGS,
    ...useWorktreeSettingsStore.getState().settingsByProject[projectPath],
    ...change,
  };
  useWorktreeSettingsStore.setState((s) => ({
    settingsByProject: { ...s.settingsByProject, [projectPath]: settings },
  }));
  try {
    await window.api.globalSettings.set(worktreeSettingsKey(projectPath), serializeWorktreeSettings(settings));
  } catch (error) {
    worktreeSettingsLog.error('failed to persist settings', {
      projectPath,
      ...change,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
