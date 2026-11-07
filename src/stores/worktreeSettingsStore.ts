import { create } from 'zustand';
import log from 'electron-log/renderer';

const worktreeSettingsLog = log.scope('worktreeSettings');

export type WorktreeMode = 'quick-start' | 'clean-checkout';

export const DEFAULT_MODE: WorktreeMode = 'quick-start';

interface WorktreeSettings {
  mode: WorktreeMode;
  /** What new tasks branch from, `origin/main` say. Null branches from whatever the project has checked out. */
  base: string | null;
}

const DEFAULT_SETTINGS: WorktreeSettings = {
  mode: DEFAULT_MODE,
  base: null,
};

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
      const parsed = json ? (JSON.parse(json) as { mode?: unknown; base?: unknown }) : {};
      const mode = isWorktreeMode(parsed.mode) ? parsed.mode : DEFAULT_MODE;
      const base = typeof parsed.base === 'string' && parsed.base ? parsed.base : null;
      set((s) => ({
        settingsByProject: { ...s.settingsByProject, [projectPath]: { mode, base } },
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

  setMode: (projectPath, mode) => save(projectPath, { mode }),
  setBase: (projectPath, base) => save(projectPath, { base }),
}));

async function save(projectPath: string, change: Partial<WorktreeSettings>): Promise<void> {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...useWorktreeSettingsStore.getState().settingsByProject[projectPath],
    ...change,
  };
  useWorktreeSettingsStore.setState((s) => ({
    settingsByProject: { ...s.settingsByProject, [projectPath]: settings },
  }));
  try {
    await window.api.globalSettings.set(
      storageKey(projectPath),
      JSON.stringify({ mode: settings.mode, ...(settings.base && { base: settings.base }) }),
    );
  } catch (error) {
    worktreeSettingsLog.error('failed to persist settings', {
      projectPath,
      ...change,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
