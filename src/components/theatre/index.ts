/**
 * Theatre mode barrel exports
 * Re-exports all theatre module functionality for external use
 */

// State (non-reactive)
export {
  theatreState,
  projectSessions,
  taskTerminalMap,
  ensureHiddenSessionsContainer,
  MAX_THEATRE_TERMINALS,
  HIDDEN_SESSIONS_CONTAINER_ID,
  GIT_STATUS_IDLE_DELAY,
  GIT_STATUS_PERIODIC_INTERVAL,
  type TheatreTerminal,
  type StoredTheatreSession,
  type SummaryType,
} from './state';

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
  tasksPanelVisible,
  tasksList,
  gitDropdownVisible,
  launchDropdownVisible,
  diffFileDropdownVisible,
  resetSignals,
} from './signals';

// Effects
export {
  initializeEffects,
  cleanupEffects,
} from './effects';

// Git status
export {
  buildGitStatusHtml,
  buildGitDropdownHtml,
  switchToBranch,
  createNewBranch,
  performMergeIntoMain,
  showGitDropdown,
  hideGitDropdown,
  toggleGitDropdown,
  updateGitStatusElement,
  refreshGitStatus,
  scheduleGitStatusRefresh,
} from './gitStatus';

// Diff panel
export {
  formatDiffStats,
  buildDiffPanelHtml,
  buildDiffFileDropdownHtml,
  showDiffFileDropdown,
  hideDiffFileDropdown,
  toggleDiffFileDropdown,
  renderDiffContentHtml,
  selectDiffFile,
  showDiffPanel,
  hideDiffPanel,
  toggleDiffPanel,
} from './diffPanel';

// Terminal cards
export {
  getTerminalTheme,
  stripAnsi,
  analyzeTerminalOutput,
  updateTaskStatusIndicator,
  updateTerminalCardLabel,
  scheduleTerminalSummaryUpdate,
  createTheatreCard,
  updateCardStack,
  switchToTheatreTerminal,
  addTheatreTerminal,
  closeTheatreTerminal,
} from './terminalCards';

// Tasks panel
export {
  getTaskTerminal,
  buildTasksPanelHtml,
  buildTaskItemHtml,
  launchClaudeForTask,
  renderTasksList,
  refreshTasksList,
  showTasksPanel,
  hideTasksPanel,
  toggleTasksPanel,
} from './tasksPanel';

// Launch dropdown
export {
  buildTheatreHeader,
  buildLaunchDropdownContent,
  showLaunchDropdown,
  hideLaunchDropdown,
  toggleLaunchDropdown,
  runDefaultCommand,
} from './launchDropdown';

// Theatre mode orchestration
export {
  enterTheatreMode,
  exitTheatreMode,
  destroyTheatreSessions,
  getPreservedSessionPaths,
  hasPreservedSession,
  isInTheatreMode,
} from './theatreMode';
