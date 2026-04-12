import { create } from 'zustand';
import log from 'electron-log/renderer';

const experimentalLog = log.scope('experimental');

export interface ExperimentalFlags {
  canvas: boolean;
}

const DEFAULT_FLAGS: ExperimentalFlags = {
  canvas: false,
};

interface ExperimentalStoreState {
  flagsByProject: Record<string, ExperimentalFlags>;
}

interface ExperimentalStoreActions {
  loadFor: (projectPath: string) => Promise<void>;
  setFlag: <K extends keyof ExperimentalFlags>(
    projectPath: string,
    name: K,
    value: ExperimentalFlags[K],
  ) => Promise<void>;
  getFlags: (projectPath: string) => ExperimentalFlags;
}

type ExperimentalStore = ExperimentalStoreState & ExperimentalStoreActions;

function storageKey(projectPath: string): string {
  return 'experimental:' + projectPath;
}

export const useExperimentalStore = create<ExperimentalStore>()((set, get) => ({
  flagsByProject: {},

  getFlags: (projectPath) => get().flagsByProject[projectPath] ?? DEFAULT_FLAGS,

  loadFor: async (projectPath) => {
    try {
      const json = await window.api.globalSettings.get(storageKey(projectPath));
      const parsed = json ? (JSON.parse(json) as Partial<ExperimentalFlags>) : {};
      set((s) => ({
        flagsByProject: {
          ...s.flagsByProject,
          [projectPath]: { ...DEFAULT_FLAGS, ...parsed },
        },
      }));
    } catch (error) {
      experimentalLog.error('failed to load flags', {
        projectPath,
        error: error instanceof Error ? error.message : String(error),
      });
      set((s) => ({
        flagsByProject: { ...s.flagsByProject, [projectPath]: { ...DEFAULT_FLAGS } },
      }));
    }
  },

  setFlag: async (projectPath, name, value) => {
    const current = get().flagsByProject[projectPath] ?? DEFAULT_FLAGS;
    const next = { ...current, [name]: value };
    set((s) => ({
      flagsByProject: { ...s.flagsByProject, [projectPath]: next },
    }));
    try {
      await window.api.globalSettings.set(storageKey(projectPath), JSON.stringify(next));
    } catch (error) {
      experimentalLog.error('failed to persist flag', {
        projectPath,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
