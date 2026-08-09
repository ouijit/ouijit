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
import type { InboxResult, PrCommandSummary } from '../github/service';
import type { FileDiff } from '../types';
import type { LensGroup } from '../github/lens';

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
  /**
   * Parsed diffs per path. Held here rather than in the document so the rail
   * can bind a lens to the same hunks the document renders — two resolutions of
   * one lens would be two chances to disagree.
   */
  diffs: Map<string, FileDiff | null>;
  filesLoading: boolean;
  filesError: string | null;
  /** True when the file list came from git because the API list failed. */
  filesFromGit: boolean;

  /** Named commands configured for this project. */
  prCommands: PrCommandSummary[];
  /**
   * The lens written for this pull request, when one exists for the
   * head on screen. Whether it is applied is the reader's choice — `lensOn`.
   */
  lensGroups: LensGroup[] | null;
  lensOn: boolean;

  /**
   * Files the reviewer has finished with, for the head on screen.
   *
   * Held here rather than in the document so the rail can dim what is done and
   * the pane can collapse it from one answer — and so it survives switching to
   * the summary and back, which is not a decision to re-read anything.
   */
  viewedPaths: string[];

  drafts: ReviewDraft[];
  /** Anchor the user is currently composing a new comment on. */
  composingAt: { path: string; line: number; side: 'LEFT' | 'RIGHT' } | null;
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
  loadPrCommands: (projectPath: string) => Promise<void>;
  loadLens: (projectPath: string, prNumber: number, headSha: string) => Promise<void>;
  setLensOn: (on: boolean) => void;
  loadViewed: (projectPath: string, prNumber: number, headSha: string) => Promise<void>;
  setFileViewed: (projectPath: string, prNumber: number, headSha: string, path: string, viewed: boolean) => void;
  clearLens: (projectPath: string, prNumber: number) => Promise<void>;
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
  prCommands: [],
  lensGroups: null,
  lensOn: false,
  viewedPaths: [],
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
/**
 * What belongs to one pull request at one head, cleared wherever either
 * changes. Both are answers about specific hunks: a lens points at them, and a
 * file marked read is a claim to have read them.
 */
const CLEAR_FOR_HEAD: Pick<GithubStoreState, 'lensGroups' | 'lensOn' | 'viewedPaths'> = {
  lensGroups: null,
  lensOn: false,
  viewedPaths: [],
};

let inboxVersion = 0;
let detailVersion = 0;
let issuesVersion = 0;
let issueVersion = 0;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  /**
   * Open a different pull request: clear what is on screen, then load.
   *
   * The clearing is the whole difference between this and `reloadDetail` —
   * showing the previous pull request's description while the next one loads
   * would be a lie, and showing this one's while it refreshes is not.
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
   * Nothing visible is cleared first. Submitting a review, posting a comment
   * and every poll tick all land here, and blanking the document back to a
   * spinner each time made a two-second round trip read as the page being torn
   * down and rebuilt. The new data replaces the old when it arrives.
   */
  reloadDetail: async (projectPath) => {
    const number = get().activeNumber;
    if (number == null) return;
    const version = ++detailVersion;
    set({ detailLoading: true, detailError: null });

    try {
      const detail = await window.api.github.pullRequest(projectPath, number);
      if (version !== detailVersion || get().projectPath !== projectPath) return;
      // A lens grouped the files at one head. After a force-push those groups
      // describe a diff that no longer exists, so they go rather than quietly
      // becoming wrong.
      const staleLens = get().detail?.headSha !== detail.headSha;
      set({ detail, detailLoading: false, ...(staleLens ? CLEAR_FOR_HEAD : {}) });

      void get().loadDrafts(projectPath, number);
      // Filtered by head on the way out, so a lens describing hunks that no
      // longer exist simply does not come back.
      void get().loadLens(projectPath, number, detail.headSha);
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
      set({ detailLoading: false, filesLoading: false, ...(get().detail ? {} : { detailError: message(error) }) });
      // A refresh that fails leaves what is on screen alone — a poll tick
      // during a dropped connection should not replace a pull request you are
      // reading with an error. Only a first load has nothing to fall back to.
      if (get().detail) githubLog.warn('pull request refresh failed', { number, error: message(error) });
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
      set({ issueLoading: false, ...(get().issue ? {} : { issueError: message(error) }) });
      if (get().issue) githubLog.warn('issue refresh failed', { number, error: message(error) });
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
      githubLog.warn('failed to load review drafts', { error: message(error) });
    }
  },

  setComposingAt: (composingAt) => set({ composingAt }),
  setSubmitting: (submitting) => set({ submitting }),

  loadPrCommands: async (projectPath) => {
    try {
      const prCommands = await window.api.github.listPrCommands(projectPath);
      if (get().projectPath !== projectPath) return;
      set({ prCommands });
    } catch (error) {
      githubLog.warn('failed to load pull request commands', { error: message(error) });
    }
  },

  /**
   * Read the lens written for this pull request, if one describes this head.
   *
   * A local read, so it rides along with the detail load. It is applied as soon
   * as it is found: someone went to the trouble of having an agent describe
   * this change, and showing the flat list anyway would hide the result of that
   * work behind a control they would have to know to press.
   */
  loadLens: async (projectPath, prNumber, headSha) => {
    try {
      const result = await window.api.github.lens(projectPath, prNumber, headSha);
      if (get().projectPath !== projectPath || get().activeNumber !== prNumber) return;
      set({ lensGroups: result.groups ?? null, lensOn: Boolean(result.groups) });
    } catch (error) {
      githubLog.warn('failed to read the lens', { error: message(error) });
    }
  },

  setDiffs: (diffs) => set({ diffs }),

  setLensOn: (on) => set({ lensOn: on }),

  loadViewed: async (projectPath, prNumber, headSha) => {
    const paths = await window.api.github.viewedFiles(projectPath, prNumber, headSha);
    // The pane may have moved on while this was in flight; landing then would
    // mark files done on a pull request nobody asked about.
    if (get().projectPath !== projectPath || get().activeNumber !== prNumber) return;
    set({ viewedPaths: paths });
  },

  setFileViewed: (projectPath, prNumber, headSha, path, viewed) => {
    // Applied here and written behind: a checkbox that waits for a round trip
    // to tick is a checkbox you press twice.
    const current = get().viewedPaths;
    set({ viewedPaths: viewed ? [...new Set([...current, path])] : current.filter((p) => p !== path) });
    void window.api.github.setFileViewed(projectPath, prNumber, headSha, path, viewed).catch(() => {
      set({ viewedPaths: current });
    });
  },

  clearLens: async (projectPath, prNumber) => {
    await window.api.github.clearLens(projectPath, prNumber);
    set({ lensGroups: null, lensOn: false });
  },

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width))) }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setRailWidth: (width) => set({ railWidth: Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, Math.round(width))) }),

  reset: () => set({ ...INITIAL }),
}));
