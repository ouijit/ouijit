import { create } from 'zustand';
import log from 'electron-log/renderer';
import type {
  GithubAvailability,
  PullRequestDetail,
  PullRequestFile,
  GithubIssue,
  IssueDetail,
  ReviewDraft,
  InboxResult,
} from '../github/types';

import type { FileDiff } from '../types';
import { describeError } from '../utils/describeError';
import { toggleInList } from '../utils/toggleIn';
import type { DiffAnchor } from '../components/diff/diffAnchor';

const githubLog = log.scope('github');

/** Which pane the panel is showing: a list, or the thing you opened. */
export type GithubView = 'inbox' | 'issues' | 'detail';

interface GithubStoreState {
  projectPath: string | null;
  availability: GithubAvailability | null;
  view: GithubView;
  /** The list to return to when the detail view closes. */
  listView: 'inbox' | 'issues';

  /**
   * How the list sits beside what it opens.
   *
   * Held apart from everything else here, and deliberately not cleared with it:
   * how wide you like the list, and whether you want it at all, is not a fact
   * about a repository. Switching projects or closing a pull request should
   * leave the pane the shape you put it in.
   */
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** Width of the changed-file rail inside the code pane. */
  railWidth: number;

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
  /** Parsed diffs per path, so the rail and the document read the same hunks. */
  diffs: Map<string, FileDiff | null>;
  filesLoading: boolean;
  filesError: string | null;
  /** True when the file list came from git because the API list failed. */
  filesFromGit: boolean;

  /**
   * Files the reviewer has finished with, for the head on screen.
   *
   * Held here rather than in the document so the rail can dim what is done and
   * the pane can collapse it from one answer — and so it survives switching to
   * the summary and back, which is not a decision to re-read anything.
   */
  viewedPaths: string[];

  /**
   * The file the reader is on in the code pane, for the rail to mark.
   *
   * Here rather than in the detail view because it changes as the document is
   * scrolled: state in the view would re-render the whole diff on every frame
   * of a scroll, and only the rail needs to know.
   */
  activePath: string | null;

  drafts: ReviewDraft[];
  /** Anchor the user is currently composing a new comment on. */
  composingAt: DiffAnchor | null;
  submitting: boolean;
}

interface GithubStoreActions {
  setProject: (projectPath: string | null) => void;
  setView: (view: GithubView) => void;

  loadAvailability: (projectPath: string, recheck?: boolean) => Promise<void>;
  loadInbox: (projectPath: string) => Promise<void>;
  loadIssues: (projectPath: string) => Promise<void>;

  openPullRequest: (projectPath: string, number: number) => Promise<void>;
  openIssue: (projectPath: string, number: number) => Promise<void>;
  closeDetail: () => void;
  reloadDetail: (projectPath: string) => Promise<void>;
  reloadIssue: (projectPath: string) => Promise<void>;
  reloadOpen: (projectPath: string) => Promise<void>;

  loadDrafts: (projectPath: string, prNumber: number) => Promise<void>;
  setDiffs: (diffs: Map<string, FileDiff | null>) => void;
  setActivePath: (path: string | null) => void;
  loadViewed: (projectPath: string, prNumber: number, headSha: string) => Promise<void>;
  setFileViewed: (projectPath: string, prNumber: number, headSha: string, path: string, viewed: boolean) => void;
  setComposingAt: (anchor: GithubStoreState['composingAt']) => void;
  setSubmitting: (submitting: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRailWidth: (width: number) => void;

  reset: () => void;
}

type GithubStore = GithubStoreState & GithubStoreActions;

export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 560;

export const RAIL_DEFAULT_WIDTH = 228;
export const RAIL_MIN_WIDTH = 160;
export const RAIL_MAX_WIDTH = 480;

/**
 * One project's GitHub session, and so what gets cleared when that changes.
 *
 * The sidebar layout is excluded by type rather than by remembering not to put
 * it here — `set({ ...INITIAL })` merges, so anything left out survives a reset
 * and a project switch, which is exactly what a layout preference should do.
 */
const INITIAL: Omit<GithubStoreState, 'sidebarWidth' | 'sidebarCollapsed' | 'railWidth'> = {
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
  diffs: new Map(),
  filesLoading: false,
  filesError: null,
  filesFromGit: false,
  viewedPaths: [],
  activePath: null,
  drafts: [],
  composingAt: null,
  submitting: false,
};

/**
 * Where the reader is in one pull request at one head, cleared wherever either
 * changes. Both are claims about specific hunks — read, scrolled to — and hunks
 * do not survive a new head.
 */
const CLEAR_FOR_HEAD: Pick<GithubStoreState, 'viewedPaths' | 'activePath'> = {
  viewedPaths: [],
  activePath: null,
};

/**
 * Version counters, same pattern the project store uses: a later load bumps the
 * counter so an earlier in-flight response can't land after it and overwrite
 * fresher data. `gh` forks a process per call, so a switch mid-flight is
 * routine.
 */
let inboxVersion = 0;
let detailVersion = 0;
let issuesVersion = 0;
let issueVersion = 0;

export const useGithubStore = create<GithubStore>()((set, get) => ({
  ...INITIAL,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  sidebarCollapsed: false,
  railWidth: RAIL_DEFAULT_WIDTH,

  setProject: (projectPath) => {
    if (get().projectPath === projectPath) return;
    // Bump every counter: a detail or issue fetch already in flight for the
    // previous project would otherwise resolve into this one's store, showing
    // its pull request while every action went to the new project.
    inboxVersion++;
    issuesVersion++;
    detailVersion++;
    issueVersion++;
    set({ ...INITIAL, projectPath });
  },

  // Switching lists while something is open leaves it open — the list is a
  // sidebar, not a destination — but it does become the list closing returns to.
  setView: (view) => set(view === 'detail' ? { view } : { view, listView: view }),

  loadAvailability: async (projectPath, recheck) => {
    try {
      const availability = await window.api.github.availability(projectPath, recheck);
      if (get().projectPath !== projectPath) return;
      set({ availability });
    } catch (error) {
      githubLog.error('availability check failed', { error: describeError(error) });
      if (get().projectPath !== projectPath) return;
      set({ availability: { available: false, message: describeError(error) } });
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
      set({ inboxLoading: false, inboxError: describeError(error) });
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
      set({ issuesLoading: false, issuesError: describeError(error) });
    }
  },

  /**
   * Open a different pull request: clear what is on screen, then load.
   *
   * Clearing first is the difference between this and `reloadDetail`, which
   * refreshes the same pull request in place.
   */
  openPullRequest: async (projectPath, number) => {
    issueVersion++;
    const from = get().view;
    set({
      view: 'detail',
      // Remember which list you came from: opening a PR linked to an issue and
      // then going back should land you on issues, not on pull requests.
      ...(from !== 'detail' ? { listView: from } : {}),
      activeNumber: number,
      activeIssue: null,
      issue: null,
      // Same reason as `closeDetail`: the issue load this cancels won't clear
      // the flag itself.
      issueLoading: false,
      issueError: null,
      detail: null,
      detailLoading: true,
      detailError: null,
      files: [],
      diffs: new Map(),
      filesError: null,
      filesFromGit: false,
      drafts: [],
      composingAt: null,
      ...CLEAR_FOR_HEAD,
    });
    await get().reloadDetail(projectPath);
  },

  /**
   * Open one issue. Same pane and same chrome as a pull request — an issue you
   * can only read in a browser is an issue you stop reading here.
   */
  openIssue: async (projectPath, number) => {
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
      detailLoading: false,
      detailError: null,
      files: [],
      filesLoading: false,
      drafts: [],
      composingAt: null,
      ...CLEAR_FOR_HEAD,
    });
    await get().reloadIssue(projectPath);
  },

  closeDetail: () => {
    // Bump so a detail load still in flight can't reopen the pane behind the
    // user after they've gone back to the list.
    detailVersion++;
    issueVersion++;
    set({
      ...CLEAR_FOR_HEAD,
      view: get().listView,
      activeNumber: null,
      detail: null,
      // The load that just lost its version check returns without clearing its
      // own flag, so closing has to. Left set, the next visit to this pane opens
      // on a spinner that nothing is coming to replace.
      detailLoading: false,
      detailError: null,
      activeIssue: null,
      issue: null,
      issueLoading: false,
      issueError: null,
      files: [],
      filesLoading: false,
      drafts: [],
      composingAt: null,
    });
  },

  /**
   * Fetch the open pull request again, in place.
   *
   * Nothing visible is cleared: submitting a review, posting a comment and
   * every poll tick land here, and the new data replaces the old when it
   * arrives.
   */
  reloadDetail: async (projectPath) => {
    const number = get().activeNumber;
    if (number == null) return;
    const version = ++detailVersion;
    set({ detailLoading: true, detailError: null });

    try {
      const detail = await window.api.github.pullRequest(projectPath, number);
      if (version !== detailVersion || get().projectPath !== projectPath) return;
      // Every claim in there is about specific hunks at one head, and a
      // force-push leaves none of them true.
      const newHead = get().detail?.headSha !== detail.headSha;
      set({ detail, detailLoading: false, ...(newHead ? CLEAR_FOR_HEAD : {}) });

      void get().loadDrafts(projectPath, number);
      void get().loadViewed(projectPath, number, detail.headSha);

      // Files come second: the document renders the description first, and the
      // file list needs the base/head SHAs the detail call just returned.
      set({ filesLoading: true });
      const result = await window.api.github.pullRequestFiles(projectPath, number, detail.baseSha, detail.headSha);
      if (version !== detailVersion || get().projectPath !== projectPath) return;
      set({
        files: result.files,
        filesLoading: false,
        filesFromGit: result.fromGit,
        filesError: result.error ?? null,
      });
    } catch (error) {
      if (version !== detailVersion) return;
      set({
        detailLoading: false,
        filesLoading: false,
        ...(get().detail ? {} : { detailError: describeError(error) }),
      });
      // A refresh that fails leaves what is on screen alone — a poll tick
      // during a dropped connection should not replace a pull request you are
      // reading with an error. Only a first load has nothing to fall back to.
      if (get().detail) githubLog.warn('pull request refresh failed', { number, error: describeError(error) });
    }
  },

  reloadIssue: async (projectPath) => {
    const number = get().activeIssue;
    if (number == null) return;
    const version = ++issueVersion;
    set({ issueLoading: true, issueError: null });

    try {
      const issue = await window.api.github.issue(projectPath, number);
      if (version !== issueVersion || get().projectPath !== projectPath) return;
      set({ issue, issueLoading: false });
    } catch (error) {
      if (version !== issueVersion) return;
      set({ issueLoading: false, ...(get().issue ? {} : { issueError: describeError(error) }) });
      if (get().issue) githubLog.warn('issue refresh failed', { number, error: describeError(error) });
    }
  },

  /**
   * Refresh whatever is open. For anything that can act on both — deleting a
   * comment reaches the same endpoint from either view — so the caller doesn't
   * have to know which of the two it is looking at.
   */
  reloadOpen: async (projectPath) => {
    const store = get();
    await (store.activeIssue != null ? store.reloadIssue(projectPath) : store.reloadDetail(projectPath));
  },

  loadDrafts: async (projectPath, prNumber) => {
    try {
      const drafts = await window.api.github.drafts(projectPath, prNumber);
      if (get().activeNumber !== prNumber) return;
      set({ drafts });
    } catch (error) {
      githubLog.warn('failed to load review drafts', { error: describeError(error) });
    }
  },

  setComposingAt: (composingAt) => set({ composingAt }),
  setSubmitting: (submitting) => set({ submitting }),

  setDiffs: (diffs) => set({ diffs }),

  setActivePath: (path) => {
    if (get().activePath !== path) set({ activePath: path });
  },

  loadViewed: async (projectPath, prNumber, headSha) => {
    const paths = await window.api.github.viewedFiles(projectPath, prNumber, headSha);
    // The pane may have moved on while this was in flight; landing then would
    // mark files done on whatever is open now.
    if (get().projectPath !== projectPath || get().activeNumber !== prNumber) return;
    set({ viewedPaths: paths });
  },

  setFileViewed: (projectPath, prNumber, headSha, path, viewed) => {
    // Applied here and written behind, so the checkbox does not wait on a
    // round trip. The write reverts it on failure.
    const current = get().viewedPaths;
    set({ viewedPaths: toggleInList(current, path, viewed) });
    void window.api.github.setFileViewed(projectPath, prNumber, headSha, path, viewed).catch(() => {
      set({ viewedPaths: current });
    });
  },

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width))) }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setRailWidth: (width) => set({ railWidth: Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, Math.round(width))) }),

  reset: () => set({ ...INITIAL }),
}));
