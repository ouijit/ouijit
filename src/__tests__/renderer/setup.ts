/**
 * Test setup for renderer (React) tests.
 * Provides jsdom environment and mocks window.api.
 */
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup React DOM after each test
afterEach(() => {
  cleanup();
});

// Mock the Electron API surface
const mockApi = {
  getProjects: vi.fn().mockResolvedValue([]),
  openProject: vi.fn().mockResolvedValue({ success: true }),
  openInFinder: vi.fn().mockResolvedValue({ success: true }),
  openInEditor: vi.fn().mockResolvedValue({ success: true }),
  openFileInEditor: vi.fn().mockResolvedValue({ success: true }),
  openExternal: vi.fn().mockResolvedValue(undefined),
  refreshProjects: vi.fn().mockResolvedValue([]),
  getGitStatus: vi.fn().mockResolvedValue(null),
  getGitFileStatus: vi.fn().mockResolvedValue(null),
  getGitDropdownInfo: vi.fn().mockResolvedValue(null),
  gitCheckout: vi.fn().mockResolvedValue({ success: true }),
  gitCreateBranch: vi.fn().mockResolvedValue({ success: true }),
  gitMergeIntoMain: vi.fn().mockResolvedValue({ success: true }),
  getFileDiff: vi.fn().mockResolvedValue(null),
  createProject: vi.fn().mockResolvedValue({ success: true }),
  showFolderPicker: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  addProject: vi.fn().mockResolvedValue({ success: true }),
  removeProject: vi.fn().mockResolvedValue({ success: true }),
  reorderProjects: vi.fn().mockResolvedValue({ success: true }),
  onFullscreenChange: vi.fn().mockReturnValue(() => {}),
  getProjectSettings: vi.fn().mockResolvedValue({}),
  setKillExistingOnRun: vi.fn().mockResolvedValue({ success: true }),
  getPathForFile: vi.fn().mockReturnValue(''),
  homePath: vi.fn().mockResolvedValue('/Users/test'),
  pty: {
    spawn: vi.fn().mockResolvedValue({ success: true, ptyId: 'pty-test-1' }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
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
  tags: {
    getAll: vi.fn().mockResolvedValue([]),
    getForTask: vi.fn().mockResolvedValue([]),
    addToTask: vi.fn().mockResolvedValue({ id: 1, name: 'test' }),
    removeFromTask: vi.fn().mockResolvedValue(undefined),
    setTaskTags: vi.fn().mockResolvedValue([]),
  },
  claudeHooks: {
    onStatus: vi.fn().mockReturnValue(() => {}),
    getStatus: vi.fn().mockResolvedValue(null),
  },
  plan: {
    read: vi.fn().mockResolvedValue(null),
    watch: vi.fn().mockResolvedValue({ success: true }),
    unwatch: vi.fn().mockResolvedValue(undefined),
    getForPty: vi.fn().mockResolvedValue(null),
    onDetected: vi.fn().mockReturnValue(() => {}),
    onReady: vi.fn().mockReturnValue(() => {}),
    onContentChanged: vi.fn().mockReturnValue(() => {}),
    checkFilesExist: vi.fn().mockResolvedValue({}),
  },
  lima: {
    status: vi.fn().mockResolvedValue('stopped'),
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    getConfig: vi.fn().mockResolvedValue({ memoryGiB: 4, diskGiB: 50 }),
    setConfig: vi.fn().mockResolvedValue({ success: true }),
    recreate: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    onSpawnProgress: vi.fn().mockReturnValue(() => {}),
    onSandboxDiverged: vi.fn().mockReturnValue(() => {}),
  },
  globalSettings: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue({ success: true }),
  },
};

Object.defineProperty(window, 'api', {
  value: mockApi,
  writable: true,
});
