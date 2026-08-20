/**
 * Test setup for renderer (React) tests.
 * Provides jsdom environment and mocks window.api.
 */
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Importing the renderer logger under jsdom hangs — no error, no timeout, it
 * takes the whole run with it, and the only symptom is a test file that never
 * reports. Every renderer test so far has mocked it at the top of the file,
 * which works but means the next one that does not gets an hour of bisecting.
 * Mocked here so a component can be imported without knowing this.
 */
vi.mock('electron-log/renderer', () => ({
  default: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Cleanup React DOM after each test
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia; the theme manager queries the OS
// appearance at module load.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Stub the icon registry. The real module statically imports ~200 Phosphor
// SVGs via Vite's `?raw` query, which Vitest's resolver chokes on (each
// import is a separate fetch through the asset transform pipeline). Tests
// don't need real icon glyphs — an empty proxy satisfies any name lookup.
vi.mock('../../utils/icons', () => ({
  iconMap: new Proxy({} as Record<string, string>, {
    get: () => '<svg></svg>',
  }),
}));

const mockApi = {
  getProjects: vi.fn().mockResolvedValue([]),
  openProject: vi.fn().mockResolvedValue({ success: true }),
  openInFinder: vi.fn().mockResolvedValue({ success: true }),
  openFileInEditor: vi.fn().mockResolvedValue({ success: true }),
  openExternal: vi.fn().mockResolvedValue(undefined),
  refreshProjects: vi.fn().mockResolvedValue([]),
  getGitStatus: vi.fn().mockResolvedValue(null),
  getGitFileStatus: vi.fn().mockResolvedValue(null),
  getGitDropdownInfo: vi.fn().mockResolvedValue(null),
  listDiffBases: vi.fn().mockResolvedValue({ refs: [], upstream: null, defaultRemote: null, lastFetch: null }),
  fetchDiffBase: vi.fn().mockResolvedValue({ success: true }),
  gitCheckout: vi.fn().mockResolvedValue({ success: true }),
  gitCreateBranch: vi.fn().mockResolvedValue({ success: true }),
  gitMergeIntoMain: vi.fn().mockResolvedValue({ success: true }),
  getFileDiff: vi.fn().mockResolvedValue(null),
  createProject: vi.fn().mockResolvedValue({ success: true }),
  showFolderPicker: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  addProject: vi.fn().mockResolvedValue({ success: true }),
  initGitRepo: vi.fn().mockResolvedValue({ success: true }),
  removeProject: vi.fn().mockResolvedValue({ success: true }),
  reorderProjects: vi.fn().mockResolvedValue({ success: true }),
  setProjectIconColor: vi.fn().mockResolvedValue({ success: true }),
  onFullscreenChange: vi.fn().mockReturnValue(() => {}),
  getPathForFile: vi.fn().mockReturnValue(''),
  homePath: vi.fn().mockResolvedValue('/Users/test'),
  pty: {
    spawn: vi.fn().mockResolvedValue({ success: true, ptyId: 'pty-test-1' }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    setLabel: vi.fn(),
    onData: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn().mockReturnValue(() => {}),
    getActiveSessions: vi.fn().mockResolvedValue([]),
    reconnect: vi.fn().mockResolvedValue({ success: true }),
    setWindow: vi.fn(),
  },
  worktree: {
    validateBranchName: vi.fn().mockResolvedValue({ valid: true }),
    generateBranchName: vi.fn().mockResolvedValue('feat/test'),
    remove: vi.fn().mockResolvedValue({ success: true }),
    list: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue(null),
    getFileDiff: vi.fn().mockResolvedValue(null),
    merge: vi.fn().mockResolvedValue({ success: true }),
    ship: vi.fn().mockResolvedValue({ success: true }),
    listBranches: vi.fn().mockResolvedValue([]),
    getMainBranch: vi.fn().mockResolvedValue('main'),
  },
  task: {
    create: vi.fn().mockResolvedValue({ success: true }),
    createAndStart: vi.fn().mockResolvedValue({ success: true }),
    start: vi.fn().mockResolvedValue({ success: true }),
    getAll: vi.fn().mockResolvedValue([]),
    getByNumber: vi.fn().mockResolvedValue(null),
    setStatus: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    trash: vi.fn().mockResolvedValue({ success: true }),
    setMergeTarget: vi.fn().mockResolvedValue({ success: true }),
    setSandboxed: vi.fn().mockResolvedValue({ success: true }),
    setName: vi.fn().mockResolvedValue({ success: true }),
    setDescription: vi.fn().mockResolvedValue({ success: true }),
    reorder: vi.fn().mockResolvedValue({ success: true }),
    checkWorktree: vi.fn().mockResolvedValue({ exists: true }),
    recover: vi.fn().mockResolvedValue({ success: true }),
  },
  hooks: {
    get: vi.fn().mockResolvedValue({}),
    save: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  scripts: {
    getAll: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    reorder: vi.fn().mockResolvedValue({ success: true }),
  },
  tags: {
    getAll: vi.fn().mockResolvedValue([]),
    getForTask: vi.fn().mockResolvedValue([]),
    addToTask: vi.fn().mockResolvedValue({ id: 1, name: 'test' }),
    removeFromTask: vi.fn().mockResolvedValue(undefined),
    setTaskTags: vi.fn().mockResolvedValue([]),
  },
  agentHooks: {
    onStatus: vi.fn().mockReturnValue(() => {}),
    getStatus: vi.fn().mockResolvedValue(null),
  },
  plan: {
    read: vi.fn().mockResolvedValue(null),
    watch: vi.fn().mockResolvedValue({ success: true }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onContentChanged: vi.fn().mockReturnValue(() => {}),
    checkFilesExist: vi.fn().mockResolvedValue({}),
  },
  lima: {
    status: vi.fn().mockResolvedValue({ available: false, vmStatus: 'Stopped' }),
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    getConfig: vi.fn().mockResolvedValue({ memoryGiB: 4, diskGiB: 10 }),
    setConfig: vi.fn().mockResolvedValue({ success: true }),
    getYaml: vi.fn().mockResolvedValue(''),
    getMergedYaml: vi.fn().mockResolvedValue(''),
    setYaml: vi.fn().mockResolvedValue({ success: true }),
    recreate: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    onSpawnProgress: vi.fn().mockReturnValue(() => {}),
    onSandboxDiverged: vi.fn().mockReturnValue(() => {}),
  },
  sandbox: {
    status: vi.fn().mockResolvedValue([]),
    nonoConfig: vi.fn().mockResolvedValue({}),
    setNonoConfig: vi.fn().mockResolvedValue({ success: true }),
  },
  globalSettings: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue({ success: true }),
  },
  health: {
    check: vi.fn().mockResolvedValue({
      git: true,
      claude: true,
      codex: true,
      pi: true,
      opencode: true,
      lima: false,
      nono: false,
      gh: true,
      ghVersionOk: true,
    }),
    onUpdate: vi.fn().mockReturnValue(() => {}),
  },
  diffNotes: {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue({ success: true }),
    clear: vi.fn().mockResolvedValue({ success: true }),
  },
  github: {
    availability: vi.fn().mockResolvedValue({ available: false, reason: 'flag-off' }),
    inbox: vi
      .fn()
      .mockResolvedValue({ viewer: '', needsReview: [], mine: [], others: [], draftCounts: {}, linkedTasks: {} }),
    pullRequest: vi.fn().mockResolvedValue(null),
    pullRequestFreshness: vi
      .fn()
      .mockResolvedValue({ headSha: 'bbb', updatedAt: '2026-07-02T00:00:00.000Z', state: 'open', isDraft: false }),
    pullRequestFiles: vi.fn().mockResolvedValue({ files: [], fromGit: false }),
    pullRequestFileDiff: vi.fn().mockResolvedValue(null),
    pullRequestFileVersions: vi.fn().mockResolvedValue({ before: null, after: null }),
    issues: vi.fn().mockResolvedValue([]),
    issue: vi.fn().mockResolvedValue(null),
    linkTaskIssue: vi.fn().mockResolvedValue({ success: true }),
    detectTaskPr: vi.fn().mockResolvedValue({ prNumber: null }),
    detectProjectPrs: vi.fn().mockResolvedValue({ linked: 0 }),
    drafts: vi.fn().mockResolvedValue([]),
    viewedFiles: vi.fn().mockResolvedValue([]),
    setFileViewed: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue({ id: 'draft-1' }),
    discardDraft: vi.fn().mockResolvedValue({ success: true }),
    submitReview: vi.fn().mockResolvedValue({ success: true }),
    comment: vi.fn().mockResolvedValue({ success: true }),
    replyToThread: vi.fn().mockResolvedValue({ success: true }),
    deleteComment: vi.fn().mockResolvedValue({ success: true }),
    resolveThread: vi.fn().mockResolvedValue({ success: true }),
    createPr: vi.fn().mockResolvedValue({ success: true }),
    mergePr: vi.fn().mockResolvedValue({ success: true }),
    taskFromIssue: vi.fn().mockResolvedValue({ success: true }),
    taskFromPr: vi.fn().mockResolvedValue({ success: true }),
    onDraftsChanged: vi.fn().mockReturnValue(() => {}),
  },
};

Object.defineProperty(window, 'api', {
  value: mockApi,
  writable: true,
});

// jsdom implements neither of these; Chromium implements both. Stubbed rather
// than guarded at the call site so components can use them unconditionally.
if (!('IntersectionObserver' in window)) {
  class NoopIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: number[] = [];
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    value: NoopIntersectionObserver,
    writable: true,
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
