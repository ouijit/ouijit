/**
 * Project mode barrel exports
 * Re-exports all project module functionality for external use
 */

// State (non-reactive)
export {
  projectState,
  ensureHiddenSessionsContainer,
  STACK_PAGE_SIZE,
  HIDDEN_SESSIONS_CONTAINER_ID,
  GIT_STATUS_IDLE_DELAY,
  GIT_STATUS_PERIODIC_INTERVAL,
  type SummaryType,
} from './state';

// Terminal class
export { OuijitTerminal, scrollSafeFit } from './terminal';

// Terminal manager singleton
export { getManager, type StoredSession } from './terminalManager';

// Helpers (utility functions and cross-module registry)
export {
  getTerminalGitPath,
  hideRunnerPanel,
  projectRegistry,
} from './helpers';

// Signals (reactive state)
export {
  projectPath,
  projectData,
  isInProjectMode as isInProjectModeSignal,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  gitDropdownVisible,
  launchDropdownVisible,
  homeViewActive,
  resetSignals,
} from './signals';

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
  updateCardStack,
  addProjectTerminal,
  closeProjectTerminal,
  buildEmptyStateHtml,
  showStackEmptyState,
  hideStackEmptyState,
  setupCardActions,
  reconnectTerminal,
} from './terminalCards';

// Launch dropdown
export {
  buildProjectHeader,
  buildLaunchDropdownContent,
  showLaunchDropdown,
  hideLaunchDropdown,
  toggleLaunchDropdown,
} from './launchDropdown';

// Project mode orchestration
export {
  enterProjectMode,
  exitProjectMode,
  restoreProjectMode,
  destroyProjectSessions,
  getPreservedSessionPaths,
  hasPreservedSession,
  isInProjectMode,
} from './projectMode';

// Worktree/task operations
export {
  closeTask,
  reopenTask,
  deleteTask,
} from './worktreeDropdown';
