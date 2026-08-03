import { create } from 'zustand';
import log from 'electron-log/renderer';
import type {
  GithubAvailability,
  PullRequestDetail,
  PullRequestFile,
  GithubIssue,
  IssueDetail,
  ReviewDraft,
} from '../github/types';
import type { InboxResult } from '../github/service';

const githubLog = log.scope('github');

/** Which pane the panel is showing: a list, or the thing you opened. */
export type GithubView = 'inbox' | 'issues' | 'detail';

interface GithubStoreState {
  projectPath: string | null;
  availability: GithubAvailability | null;
  view: GithubView;
  /** The list to return to when the detail view closes. */
  listView: 'inbox' | 'issues';

  inbox: InboxResult | null;
  inboxLoading: boolean;
  inboxError: string | null;

  issues: GithubIssue[];
  issuesLoading: boolean;
  issuesError: string | null;

  /** Issue currently open in the detail view. Exclusive with `activeNumber`. */
  activeIssue: number | null;
  issue: IssueDetail | null;
  issueLoading: boolean;
  issueError: string | null;

  /** PR currently open in the detail view. */
  activeNumber: number | null;
  detail: PullRequestDetail | null;
  detailLoading: boolean;
  detailError: string | null;

  files: PullRequestFile[];
  filesLoading: boolean;
  filesError: string | null;
  /** True when the file list came from git because the API list failed. */
  filesFromGit: boolean;

  drafts: ReviewDraft[];
  /** Anchor the user is currently composing a new comment on. */
  composingAt: { path: string; line: number; side: 'LEFT' | 'RIGHT' } | null;
  submitting: boolean;
}

interface GithubStoreActions {
  setProject: (projectPath: string | null) => void;
  setView: (view: GithubView) => void;

  loadAvailability: (projectPath: string) => Promise<void>;
  loadInbox: (projectPath: string) => Promise<void>;
  loadIssues: (projectPath: string) => Promise<void>;

  openPullRequest: (projectPath: string, number: number) => Promise<void>;
  openIssue: (projectPath: string, number: number) => Promise<void>;
  closeDetail: () => void;
  reloadDetail: (projectPath: string) => Promise<void>;
  reloadIssue: (projectPath: string) => Promise<void>;

  loadDrafts: (projectPath: string, prNumber: number) => Promise<void>;
  setComposingAt: (anchor: GithubStoreState['composingAt']) => void;
  setSubmitting: (submitting: boolean) => void;

  reset: () => void;
}

type GithubStore = GithubStoreState & GithubStoreActions;

const INITIAL: GithubStoreState = {
  projectPath: null,
  availability: null,
  view: 'inbox',
  listView: 'inbox',
  inbox: null,
  inboxLoading: false,
  inboxError: null,
  issues: [],
  issuesLoading: false,
  issuesError: null,
  activeIssue: null,
  issue: null,
  issueLoading: false,
  issueError: null,
  activeNumber: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  files: [],
  filesLoading: false,
  filesError: null,
  filesFromGit: false,
  drafts: [],
  composingAt: null,
  submitting: false,
};

/**
 * Version counters, same pattern the project store uses: a later load bumps the
 * counter so an earlier in-flight response can't land after it and overwrite
 * fresher data. Switching projects or PRs while a `gh` call is running is the
 * normal case here, not an edge case — `gh` forks a process per call.
 */
let inboxVersion = 0;
let detailVersion = 0;
let issuesVersion = 0;
let issueVersion = 0;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useGithubStore = create<GithubStore>()((set, get) => ({
  ...INITIAL,

  setProject: (projectPath) => {
    if (get().projectPath === projectPath) return;
    set({ ...INITIAL, projectPath });
  },

  // Switching lists while something is open leaves it open — the list is a
  // sidebar, not a destination — but it does become the list closing returns to.
  setView: (view) => set(view === 'detail' ? { view } : { view, listView: view }),

  loadAvailability: async (projectPath) => {
    try {
      const availability = await window.api.github.availability(projectPath);
      if (get().projectPath !== projectPath) return;
      set({ availability });
    } catch (error) {
      githubLog.error('availability check failed', { error: message(error) });
      if (get().projectPath !== projectPath) return;
      set({ availability: { available: false, message: message(error) } });
    }
  },

  loadInbox: async (projectPath) => {
    const version = ++inboxVersion;
    set({ inboxLoading: true, inboxError: null });
    try {
      const inbox = await window.api.github.inbox(projectPath);
      if (version !== inboxVersion || get().projectPath !== projectPath) return;
      set({ inbox, inboxLoading: false });
    } catch (error) {
      if (version !== inboxVersion || get().projectPath !== projectPath) return;
      set({ inboxLoading: false, inboxError: message(error) });
    }
  },

  loadIssues: async (projectPath) => {
    const version = ++issuesVersion;
    set({ issuesLoading: true, issuesError: null });
    try {
      const issues = await window.api.github.issues(projectPath);
      if (version !== issuesVersion || get().projectPath !== projectPath) return;
      set({ issues, issuesLoading: false });
    } catch (error) {
      if (version !== issuesVersion || get().projectPath !== projectPath) return;
      set({ issuesLoading: false, issuesError: message(error) });
    }
  },

  openPullRequest: async (projectPath, number) => {
    const version = ++detailVersion;
    const from = get().view;
    set({
      view: 'detail',
      // Remember which list you came from: opening a PR linked to an issue and
      // then going back should land you on issues, not on pull requests.
      ...(from !== 'detail' ? { listView: from } : {}),
      activeNumber: number,
      activeIssue: null,
      issue: null,
      issueError: null,
      detail: null,
      detailLoading: true,
      detailError: null,
      files: [],
      filesError: null,
      filesFromGit: false,
      drafts: [],
      composingAt: null,
    });

    try {
      const detail = await window.api.github.pullRequest(projectPath, number);
      if (version !== detailVersion) return;
      set({ detail, detailLoading: false });

      void get().loadDrafts(projectPath, number);

      // Files come second: the document renders the description first, and the
      // file list needs the base/head SHAs the detail call just returned.
      set({ filesLoading: true });
      const result = await window.api.github.pullRequestFiles(projectPath, number, detail.baseSha, detail.headSha);
      if (version !== detailVersion) return;
      set({
        files: result.files,
        filesLoading: false,
        filesFromGit: result.fromGit,
        filesError: result.error ?? null,
      });
    } catch (error) {
      if (version !== detailVersion) return;
      set({ detailLoading: false, filesLoading: false, detailError: message(error) });
    }
  },

  /**
   * Open one issue. Same pane and same chrome as a pull request — an issue you
   * can only read in a browser is an issue you stop reading here.
   */
  openIssue: async (projectPath, number) => {
    const version = ++issueVersion;
    detailVersion++;
    const from = get().view;
    set({
      view: 'detail',
      ...(from !== 'detail' ? { listView: from } : {}),
      activeIssue: number,
      issue: null,
      issueLoading: true,
      issueError: null,
      activeNumber: null,
      detail: null,
      detailError: null,
      files: [],
      drafts: [],
      composingAt: null,
    });

    try {
      const issue = await window.api.github.issue(projectPath, number);
      if (version !== issueVersion) return;
      set({ issue, issueLoading: false });
    } catch (error) {
      if (version !== issueVersion) return;
      set({ issueLoading: false, issueError: message(error) });
    }
  },

  closeDetail: () => {
    // Bump so a detail load still in flight can't reopen the pane behind the
    // user after they've gone back to the list.
    detailVersion++;
    issueVersion++;
    set({
      view: get().listView,
      activeNumber: null,
      detail: null,
      detailError: null,
      activeIssue: null,
      issue: null,
      issueError: null,
      files: [],
      drafts: [],
      composingAt: null,
    });
  },

  reloadDetail: async (projectPath) => {
    const number = get().activeNumber;
    if (number == null) return;
    await get().openPullRequest(projectPath, number);
  },

  reloadIssue: async (projectPath) => {
    const number = get().activeIssue;
    if (number == null) return;
    await get().openIssue(projectPath, number);
  },

  loadDrafts: async (projectPath, prNumber) => {
    try {
      const drafts = await window.api.github.drafts(projectPath, prNumber);
      if (get().activeNumber !== prNumber) return;
      set({ drafts });
    } catch (error) {
      githubLog.warn('failed to load review drafts', { error: message(error) });
    }
  },

  setComposingAt: (composingAt) => set({ composingAt }),
  setSubmitting: (submitting) => set({ submitting }),

  reset: () => set({ ...INITIAL }),
}));
