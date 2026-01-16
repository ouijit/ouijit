/**
 * Theatre mode barrel exports
 * Re-exports all theatre module functionality for external use
 */

// State (non-reactive)
export {
  theatreState,
  projectSessions,
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

// Git status (per-terminal)
export {
  hideGitDropdown,
  refreshGitStatus,
  scheduleGitStatusRefresh,
  getTerminalGitPath,
  scheduleTerminalGitStatusRefresh,
  refreshTerminalGitStatus,
  refreshAllTerminalGitStatus,
  buildCardGitStatusHtml,
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
} from './terminalCards';

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
