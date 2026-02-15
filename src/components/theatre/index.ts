/**
 * Theatre mode barrel exports
 * Re-exports all theatre module functionality for external use
 */

// State (non-reactive)
export {
  theatreState,
  projectSessions,
  orphanedSessions,
  ensureHiddenSessionsContainer,
  MAX_THEATRE_TERMINALS,
  HIDDEN_SESSIONS_CONTAINER_ID,
  GIT_STATUS_IDLE_DELAY,
  GIT_STATUS_PERIODIC_INTERVAL,
  type TheatreTerminal,
  type StoredTheatreSession,
  type SummaryType,
} from './state';

// Helpers (utility functions and cross-module registry)
export {
  getTerminalGitPath,
  hideRunnerPanel,
  theatreRegistry,
} from './helpers';

// Signals (reactive state)
export {
  projectPath,
  projectData,
  terminals,
  activeIndex,
  activeTerminal,
  isInTheatreMode as isInTheatreModeSignal,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  gitDropdownVisible,
  launchDropdownVisible,
  resetSignals,
} from './signals';

// Effects
export {
  initializeEffects,
  cleanupEffects,
} from './effects';

// Git status (per-terminal)
export {
  hideGitDropdown,
  refreshGitStatus,
  scheduleGitStatusRefresh,
  scheduleTerminalGitStatusRefresh,
  refreshTerminalGitStatus,
  refreshAllTerminalGitStatus,
  buildCardGitBranchHtml,
  buildCardGitStatsHtml,
} from './gitStatus';

// Diff panel
export {
  formatDiffStats,
  buildDiffPanelHtml,
  buildFileListHtml,
  buildStackedDiffsHtml,
  loadAllDiffs,
  wireSidebarNavigation,
  renderDiffContentHtml,
  showDiffPanel,
  hideDiffPanel,
  toggleDiffPanel,
} from './diffPanel';

// Terminal cards
export {
  getTerminalTheme,
  stripAnsi,
  analyzeTerminalOutput,
  updateTerminalCardLabel,
  scheduleTerminalSummaryUpdate,
  createTheatreCard,
  updateCardStack,
  switchToTheatreTerminal,
  addTheatreTerminal,
  closeTheatreTerminal,
  buildEmptyStateHtml,
  showStackEmptyState,
  hideStackEmptyState,
  setupCardActions,
} from './terminalCards';

// Launch dropdown
export {
  buildTheatreHeader,
  buildLaunchDropdownContent,
  showLaunchDropdown,
  hideLaunchDropdown,
  toggleLaunchDropdown,
} from './launchDropdown';

// Theatre mode orchestration
export {
  enterTheatreMode,
  exitTheatreMode,
  restoreTheatreMode,
  destroyTheatreSessions,
  getPreservedSessionPaths,
  hasPreservedSession,
  isInTheatreMode,
} from './theatreMode';

// Worktree/task operations
export {
  closeTask,
  reopenTask,
  deleteTask,
} from './worktreeDropdown';
