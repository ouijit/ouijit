import { create } from 'zustand';
import type { ScriptHook, TaskWithWorkspace } from '../types';
import { queuePrompt, settlePrompt, type Pending } from './promptQueue';

export type SidebarGroupMode = 'project' | 'tag';

export type MissingWorktreeAction = 'recover' | null;

export interface MissingWorktreeInput {
  task: TaskWithWorkspace;
  branchExists: boolean;
}

export type MissingWorktreeRequest = MissingWorktreeInput & Pending<MissingWorktreeAction>;

export interface EditorHookInput {
  projectPath: string;
  /** The command that just failed, when the dialog is opened to correct it. */
  existingHook?: ScriptHook;
}

export type EditorHookRequest = EditorHookInput & Pending<ScriptHook | null>;

interface UIStoreState {
  /** Persisted in global settings. */
  sidebarShown: boolean;
  /** Hovered into view while it is not shown. */
  sidebarRevealed: boolean;
  /** Persisted in global settings. */
  sidebarGroupMode: SidebarGroupMode;
  /** Sidebar groups, by key, that are folded away. */
  collapsedGroups: Record<string, true>;
  gitDropdownVisible: boolean;
  /** Command palette (mod+K) visibility. Session-only. */
  paletteOpen: boolean;
  /** Opening several tasks at once can find more than one worktree missing. */
  missingWorktreeQueue: MissingWorktreeRequest[];
  /**
   * Registering an editor, asked for by whatever tried to open one. It lives
   * here because opening a task creates its worktree, which moves the card
   * that asked to another column and unmounts it mid-request.
   */
  editorHookQueue: EditorHookRequest[];
  diffFileListCollapsed: boolean;
  diffFileListWidth: number;
}

interface UIStoreActions {
  setSidebarShown: (shown: boolean) => void;
  setSidebarRevealed: (revealed: boolean) => void;
  setSidebarGroupMode: (mode: SidebarGroupMode) => void;
  toggleGroupCollapsed: (key: string) => void;
  expandGroups: (keys: string[]) => void;
  setGitDropdownVisible: (visible: boolean) => void;
  closeAllDropdowns: () => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  requestMissingWorktree: (req: MissingWorktreeInput) => Promise<MissingWorktreeAction>;
  resolveMissingWorktree: (id: number, action: MissingWorktreeAction) => void;
  requestEditorHook: (req: EditorHookInput) => Promise<ScriptHook | null>;
  resolveEditorHook: (id: number, hook: ScriptHook | null) => void;
  setDiffFileListCollapsed: (collapsed: boolean) => void;
  setDiffFileListWidth: (width: number) => void;
}

type UIStore = UIStoreState & UIStoreActions;

export const DIFF_FILE_LIST_DEFAULT_WIDTH = 220;
export const DIFF_FILE_LIST_MIN_WIDTH = 120;
export const DIFF_FILE_LIST_MAX_WIDTH = 500;

function clampFileListWidth(width: number): number {
  return Math.max(DIFF_FILE_LIST_MIN_WIDTH, Math.min(DIFF_FILE_LIST_MAX_WIDTH, Math.round(width)));
}

export const useUIStore = create<UIStore>()((set, get) => ({
  sidebarShown: true,
  sidebarRevealed: false,
  sidebarGroupMode: 'project',
  collapsedGroups: {},
  gitDropdownVisible: false,
  paletteOpen: false,
  missingWorktreeQueue: [],
  editorHookQueue: [],
  diffFileListCollapsed: false,
  diffFileListWidth: DIFF_FILE_LIST_DEFAULT_WIDTH,

  setSidebarShown: (shown) => {
    set({ sidebarShown: shown, sidebarRevealed: false });
    void window.api.globalSettings.set('ui:sidebar-shown', shown ? '1' : '0');
  },

  setSidebarRevealed: (revealed) => {
    if (get().sidebarRevealed !== revealed) set({ sidebarRevealed: revealed });
  },

  setSidebarGroupMode: (mode) => {
    set({ sidebarGroupMode: mode });
    void window.api.globalSettings.set('ui:sidebar-group', mode);
  },

  toggleGroupCollapsed: (key) => {
    const { [key]: collapsed, ...rest } = get().collapsedGroups;
    set({ collapsedGroups: collapsed ? rest : { ...rest, [key]: true } });
  },

  expandGroups: (keys) => {
    const collapsed = get().collapsedGroups;
    if (!keys.some((key) => collapsed[key])) return;
    set({ collapsedGroups: Object.fromEntries(Object.entries(collapsed).filter(([key]) => !keys.includes(key))) });
  },

  setGitDropdownVisible: (visible) => set({ gitDropdownVisible: visible }),

  closeAllDropdowns: () => set({ gitDropdownVisible: false }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  requestMissingWorktree: (req) =>
    queuePrompt<MissingWorktreeInput, MissingWorktreeAction>(req, (entry) =>
      set((s) => ({ missingWorktreeQueue: [...s.missingWorktreeQueue, entry] })),
    ),

  resolveMissingWorktree: (id, action) => {
    const next = settlePrompt(get().missingWorktreeQueue, id, action);
    if (next) set({ missingWorktreeQueue: next });
  },

  requestEditorHook: (req) =>
    queuePrompt<EditorHookInput, ScriptHook | null>(req, (entry) =>
      set((s) => ({ editorHookQueue: [...s.editorHookQueue, entry] })),
    ),

  resolveEditorHook: (id, hook) => {
    const next = settlePrompt(get().editorHookQueue, id, hook);
    if (next) set({ editorHookQueue: next });
  },

  setDiffFileListCollapsed: (collapsed) => {
    set({ diffFileListCollapsed: collapsed });
    void window.api.globalSettings.set('ui:diff-file-list-collapsed', collapsed ? '1' : '0');
  },

  setDiffFileListWidth: (width) => {
    const clamped = clampFileListWidth(width);
    set({ diffFileListWidth: clamped });
    void window.api.globalSettings.set('ui:diff-file-list-width', String(clamped));
  },
}));

export async function hydrateUIPreferences(): Promise<void> {
  const [shown, groupMode, collapsed, width] = await Promise.all([
    window.api.globalSettings.get('ui:sidebar-shown'),
    window.api.globalSettings.get('ui:sidebar-group'),
    window.api.globalSettings.get('ui:diff-file-list-collapsed'),
    window.api.globalSettings.get('ui:diff-file-list-width'),
  ]);

  const next: Partial<UIStoreState> = {};
  if (shown === '0' || shown === '1') next.sidebarShown = shown === '1';
  if (groupMode === 'project' || groupMode === 'tag') next.sidebarGroupMode = groupMode;
  if (collapsed === '0' || collapsed === '1') next.diffFileListCollapsed = collapsed === '1';
  const parsedWidth = Number(width);
  if (width && Number.isFinite(parsedWidth)) next.diffFileListWidth = clampFileListWidth(parsedWidth);

  useUIStore.setState(next);
}
