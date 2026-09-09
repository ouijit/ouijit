import { create } from 'zustand';
import log from 'electron-log/renderer';
import type {
  LinearAvailability,
  LinearCommentDraft,
  LinearIssueDetail,
  LinearIssueGroups,
  LinearScope,
} from '../linear/types';
import { describeError } from '../utils/describeError';
import { usePanelStore } from './panelStore';

const linearLog = log.scope('linear');

/**
 * Linear's half of the panel: what was fetched, and nothing about what the
 * panel is showing. Which issue is open lives in `panelStore`, in the one slot
 * every source shares.
 */
interface LinearStoreState {
  projectPath: string | null;
  availability: LinearAvailability | null;

  groups: LinearIssueGroups | null;
  groupsLoading: boolean;
  groupsError: string | null;

  issue: LinearIssueDetail | null;
  issueLoading: boolean;
  issueError: string | null;

  /** Comments staged against the open issue, waiting on a person. */
  drafts: LinearCommentDraft[];
}

interface LinearStoreActions {
  setProject: (projectPath: string | null) => void;
  loadAvailability: (projectPath: string, recheck?: boolean) => Promise<void>;
  loadIssues: (projectPath: string) => Promise<void>;
  connect: (projectPath: string, scope: LinearScope) => Promise<void>;

  openIssue: (projectPath: string, id: string) => Promise<void>;
  closeDetail: () => void;
  reloadIssue: (projectPath: string) => Promise<void>;
  loadDrafts: (projectPath: string, issueId: string) => Promise<void>;

  reset: () => void;
}

type LinearStore = LinearStoreState & LinearStoreActions;

const INITIAL: LinearStoreState = {
  projectPath: null,
  availability: null,
  groups: null,
  groupsLoading: false,
  groupsError: null,
  issue: null,
  issueLoading: false,
  issueError: null,
  drafts: [],
};

/** Same guard the GitHub store uses: a late response must not land on newer data. */
let groupsVersion = 0;
let issueVersion = 0;

/** The Linear issue in the panel's slot, if that is what is open. */
function openIssueId(): string | null {
  const open = usePanelStore.getState().open;
  return open?.source === 'linear' ? open.id : null;
}

export const useLinearStore = create<LinearStore>()((set, get) => ({
  ...INITIAL,

  setProject: (projectPath) => {
    if (get().projectPath === projectPath) return;
    groupsVersion++;
    issueVersion++;
    set({ ...INITIAL, projectPath });
  },

  loadAvailability: async (projectPath, recheck) => {
    try {
      const availability = await window.api.linear.availability(projectPath, recheck);
      if (get().projectPath !== projectPath) return;
      set({ availability });
    } catch (error) {
      linearLog.error('availability check failed', { error: describeError(error) });
      if (get().projectPath !== projectPath) return;
      set({ availability: { connected: false, message: describeError(error), repoLabels: [], teams: [] } });
    }
  },

  loadIssues: async (projectPath) => {
    const version = ++groupsVersion;
    set({ groupsLoading: true, groupsError: null });
    try {
      const groups = await window.api.linear.issues(projectPath);
      if (version !== groupsVersion || get().projectPath !== projectPath) return;
      set({ groups, groupsLoading: false });
    } catch (error) {
      if (version !== groupsVersion || get().projectPath !== projectPath) return;
      set({ groupsLoading: false, groupsError: describeError(error) });
    }
  },

  /** Store the scope, then load under it — the connect row's whole job. */
  connect: async (projectPath, scope) => {
    const result = await window.api.linear.setScope(projectPath, scope);
    if (!result.success) {
      set({ groupsError: result.error ?? 'Could not connect this project to Linear.' });
      return;
    }
    await get().loadAvailability(projectPath, true);
    await get().loadIssues(projectPath);
  },

  openIssue: async (projectPath, id) => {
    usePanelStore.getState().setOpen({ source: 'linear', id });
    set({ issue: null, issueLoading: true, issueError: null, drafts: [] });
    await get().reloadIssue(projectPath);
  },

  closeDetail: () => {
    // Bump so a load still in flight cannot reopen the pane behind the user,
    // and clear the flag it will not clear itself.
    issueVersion++;
    usePanelStore.getState().close();
    set({ issue: null, issueLoading: false, issueError: null, drafts: [] });
  },

  reloadIssue: async (projectPath) => {
    const id = openIssueId();
    if (id == null) return;
    const version = ++issueVersion;
    set({ issueLoading: true, issueError: null });
    try {
      const issue = await window.api.linear.issue(projectPath, id);
      if (version !== issueVersion || get().projectPath !== projectPath) return;
      set({ issue, issueLoading: false });
      void get().loadDrafts(projectPath, issue.id);
    } catch (error) {
      if (version !== issueVersion) return;
      // A refresh that fails leaves what is on screen alone; only a first load
      // has nothing to fall back to.
      set({ issueLoading: false, ...(get().issue ? {} : { issueError: describeError(error) }) });
      if (get().issue) linearLog.warn('issue refresh failed', { error: describeError(error) });
    }
  },

  loadDrafts: async (projectPath, issueId) => {
    try {
      const drafts = await window.api.linear.drafts(projectPath, issueId);
      if (get().issue?.id !== issueId) return;
      set({ drafts });
    } catch (error) {
      linearLog.warn('failed to load comment drafts', { error: describeError(error) });
    }
  },

  reset: () => set({ ...INITIAL }),
}));
