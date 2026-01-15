# Terminal Component Split Plan

This document provides a detailed implementation plan for splitting `src/components/terminalComponent.ts` (2693 lines) into focused modules.

## Prerequisites

The following infrastructure is already in place:
- `src/components/theatre/state.ts` - Shared state object and types
- `src/utils/dropdown.ts` - Reusable dropdown manager
- `src/utils/html.ts` - escapeHtml utility
- `src/utils/runConfigs.ts` - getConfigId, mergeRunConfigs

---

## Module Structure

```
src/components/
├── terminalComponent.ts      # Core terminal + re-exports (reduced to ~400 lines)
└── theatre/
    ├── state.ts              # ✓ Already exists - shared state
    ├── index.ts              # Barrel exports
    ├── theatreMode.ts        # Enter/exit theatre, session management
    ├── terminalCards.ts      # Multi-terminal card UI, output analysis
    ├── gitStatus.ts          # Git status display, branch dropdown
    ├── diffPanel.ts          # Diff panel, file selector
    ├── tasksPanel.ts         # Tasks panel, task-terminal linking
    └── launchDropdown.ts     # Command dropdown for theatre mode
```

---

## Step 1: Migrate State to Shared Module

### Current Local State in terminalComponent.ts (lines 47-121)

The following local variables need to be replaced with imports from `theatre/state.ts`:

```typescript
// REMOVE these local declarations:
let theatreTerminals: TheatreTerminal[] = [];
let activeTheatreIndex: number = 0;
let theatreProjectData: Project | null = null;
let theatreModeProjectPath: string | null = null;
let originalHeaderContent: string | null = null;
let escapeKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let gitStatusIdleTimeout, gitStatusPeriodicInterval, lastTerminalOutputTime
let gitDropdownVisible, gitDropdownCleanup
let diffPanelVisible, diffPanelSelectedFile, diffPanelFiles
let diffFileDropdownVisible, diffFileDropdownCleanup
let launchDropdownVisible, launchDropdownCleanup
let tasksPanelVisible, tasksList
const projectSessions = new Map<...>()
const taskTerminalMap = new Map<...>()
const MAX_THEATRE_TERMINALS = 5
const GIT_STATUS_IDLE_DELAY = 500
const GIT_STATUS_PERIODIC_INTERVAL = 5000

// REPLACE with:
import {
  theatreState,
  projectSessions,
  taskTerminalMap,
  MAX_THEATRE_TERMINALS,
  GIT_STATUS_IDLE_DELAY,
  GIT_STATUS_PERIODIC_INTERVAL,
  TheatreTerminal,
  StoredTheatreSession,
  SummaryType
} from './theatre/state';
```

### Update All References

Every function that accesses local state must be updated:

| Old Reference | New Reference |
|--------------|---------------|
| `theatreTerminals` | `theatreState.terminals` |
| `activeTheatreIndex` | `theatreState.activeIndex` |
| `theatreProjectData` | `theatreState.projectData` |
| `theatreModeProjectPath` | `theatreState.projectPath` |
| `originalHeaderContent` | `theatreState.originalHeaderContent` |
| `escapeKeyHandler` | `theatreState.escapeKeyHandler` |
| `gitDropdownVisible` | `theatreState.gitDropdownVisible` |
| `diffPanelVisible` | `theatreState.diffPanelVisible` |
| `diffPanelSelectedFile` | `theatreState.diffPanelSelectedFile` |
| `diffPanelFiles` | `theatreState.diffPanelFiles` |
| `tasksPanelVisible` | `theatreState.tasksPanelVisible` |
| `tasksList` | `theatreState.tasksList` |

---

## Step 2: Extract gitStatus.ts

**Lines to extract:** 649-947 (~300 lines)

### Functions to Move

| Function | Line | Dependencies |
|----------|------|--------------|
| `buildGitStatusHtml` | 649 | None |
| `buildGitDropdownHtml` | 718 | None |
| `switchToBranch` | 768 | `hideGitDropdown`, `refreshGitStatus`, `showToast` |
| `createNewBranch` | 788 | `hideGitDropdown`, `refreshGitStatus`, `showToast` |
| `performMergeIntoMain` | 808 | `refreshGitStatus`, `showToast` |
| `showGitDropdown` | 825 | `buildGitDropdownHtml`, `switchToBranch`, `createNewBranch` |
| `hideGitDropdown` | 925 | None |
| `toggleGitDropdown` | 947 | `showGitDropdown`, `hideGitDropdown` |
| `updateGitStatusElement` | 1564 | `buildGitStatusHtml`, `performMergeIntoMain`, `toggleGitDropdown`, `toggleDiffPanel` |
| `refreshGitStatus` | 1639 | `updateGitStatusElement` |
| `scheduleGitStatusRefresh` | 1665 | `refreshGitStatus` |

### File Template

```typescript
// src/components/theatre/gitStatus.ts
import { createIcons } from 'lucide';
import type { CompactGitStatus, GitDropdownInfo } from '../../types';
import { theatreState, GIT_STATUS_IDLE_DELAY } from './state';
import { showToast } from '../importDialog';

// Icons needed for this module
const gitIcons = { GitBranch, ChevronDown, GitMerge, Plus };

// Forward declaration for circular dependency
let toggleDiffPanel: () => Promise<void>;
export function setToggleDiffPanel(fn: () => Promise<void>) {
  toggleDiffPanel = fn;
}

export function buildGitStatusHtml(compactStatus: CompactGitStatus | null): string { ... }
export function buildGitDropdownHtml(info: GitDropdownInfo): string { ... }
export async function switchToBranch(branchName: string): Promise<void> { ... }
export async function createNewBranch(branchName: string): Promise<void> { ... }
export async function performMergeIntoMain(): Promise<void> { ... }
export async function showGitDropdown(projectPath: string): Promise<void> { ... }
export function hideGitDropdown(): void { ... }
export async function toggleGitDropdown(projectPath: string): Promise<void> { ... }
export function updateGitStatusElement(compactStatus: CompactGitStatus | null): void { ... }
export async function refreshGitStatus(): Promise<void> { ... }
export function scheduleGitStatusRefresh(): void { ... }
```

---

## Step 3: Extract diffPanel.ts

**Lines to extract:** 1683-2021 (~340 lines)

### Functions to Move

| Function | Line | Dependencies |
|----------|------|--------------|
| `formatDiffStats` | 1683 | None |
| `buildDiffPanelHtml` | 1690 | `formatDiffStats`, `escapeHtml` |
| `buildDiffFileDropdownHtml` | 1719 | `formatDiffStats`, `escapeHtml` |
| `showDiffFileDropdown` | 1739 | `buildDiffFileDropdownHtml`, `selectDiffFile` |
| `hideDiffFileDropdown` | 1791 | None |
| `toggleDiffFileDropdown` | 1814 | `showDiffFileDropdown`, `hideDiffFileDropdown` |
| `renderDiffContentHtml` | 1825 | `escapeHtml` |
| `selectDiffFile` | 1859 | `renderDiffContentHtml`, `formatDiffStats` |
| `showDiffPanel` | 1918 | `buildDiffPanelHtml`, `selectDiffFile`, `toggleDiffFileDropdown` |
| `hideDiffPanel` | 1985 | None |
| `toggleDiffPanel` | 2021 | `showDiffPanel`, `hideDiffPanel` |

### File Template

```typescript
// src/components/theatre/diffPanel.ts
import { createIcons, ChevronDown } from 'lucide';
import type { ChangedFile, FileDiff } from '../../types';
import { theatreState } from './state';
import { escapeHtml } from '../../utils/html';

export function formatDiffStats(additions: number, deletions: number): string { ... }
export function buildDiffPanelHtml(files: ChangedFile[]): string { ... }
export function buildDiffFileDropdownHtml(files: ChangedFile[], selectedPath: string): string { ... }
export function showDiffFileDropdown(): void { ... }
export function hideDiffFileDropdown(): void { ... }
export function toggleDiffFileDropdown(): void { ... }
export function renderDiffContentHtml(diff: FileDiff): string { ... }
export async function selectDiffFile(filePath: string): Promise<void> { ... }
export async function showDiffPanel(): Promise<void> { ... }
export function hideDiffPanel(): void { ... }
export async function toggleDiffPanel(): Promise<void> { ... }
```

---

## Step 4: Extract tasksPanel.ts

**Lines to extract:** 1248-1520 (~270 lines)

### Functions to Move

| Function | Line | Dependencies |
|----------|------|--------------|
| `buildTasksPanelHtml` | 1248 | None |
| `getTaskTerminal` | 1266 | `taskTerminalMap` |
| `buildTaskItemHtml` | 1272 | `escapeHtml`, `getTaskTerminal` |
| `launchClaudeForTask` | 1299 | `addTheatreTerminal`, `taskTerminalMap` |
| `renderTasksList` | 1346 | `buildTaskItemHtml`, `launchClaudeForTask` |
| `refreshTasksList` | 1407 | `renderTasksList` |
| `showTasksPanel` | 1416 | `buildTasksPanelHtml`, `refreshTasksList` |
| `hideTasksPanel` | 1483 | None |
| `toggleTasksPanel` | 1520 | `showTasksPanel`, `hideTasksPanel` |
| `updateTaskStatusIndicator` | 393 | `getTaskTerminal` |

### Circular Dependency Note

`launchClaudeForTask` calls `addTheatreTerminal` from terminalCards.ts. Use dependency injection:

```typescript
// Forward declaration
let addTheatreTerminal: (runConfig?: RunConfig) => Promise<boolean>;
export function setAddTheatreTerminal(fn: (runConfig?: RunConfig) => Promise<boolean>) {
  addTheatreTerminal = fn;
}
```

---

## Step 5: Extract launchDropdown.ts

**Lines to extract:** 958-1237 (~280 lines)

### Functions to Move

| Function | Line | Dependencies |
|----------|------|--------------|
| `buildTheatreHeader` | 958 | None |
| `buildLaunchDropdownContent` | 1008 | `getConfigId`, `mergeRunConfigs`, `addTheatreTerminal` |
| `showLaunchDropdown` | 1169 | `buildLaunchDropdownContent` |
| `hideLaunchDropdown` | 1217 | None |
| `toggleLaunchDropdown` | 1237 | `showLaunchDropdown`, `hideLaunchDropdown` |
| `runDefaultCommand` | 1531 | `getConfigId`, `mergeRunConfigs`, `addTheatreTerminal` |

---

## Step 6: Extract terminalCards.ts

**Lines to extract:** 197-420, 2032-2308 (~500 lines)

### Functions to Move

| Function | Line | Dependencies |
|----------|------|--------------|
| `stripAnsi` | 197 | None |
| `analyzeTerminalOutput` | 205 | `stripAnsi` |
| `scheduleTerminalSummaryUpdate` | 342 | `analyzeTerminalOutput`, `updateTerminalCardLabel` |
| `updateTerminalCardLabel` | 360 | `updateTaskStatusIndicator` |
| `createTheatreCard` | 2032 | None |
| `updateCardStack` | 2063 | None |
| `switchToTheatreTerminal` | 2091 | `updateCardStack` |
| `addTheatreTerminal` | 2109 | `createTheatreCard`, `updateCardStack`, `scheduleTerminalSummaryUpdate`, `scheduleGitStatusRefresh` |
| `closeTheatreTerminal` | 2263 | `updateCardStack`, `switchToTheatreTerminal` |

---

## Step 7: Extract theatreMode.ts

**Lines to extract:** 73-92, 2314-2691 (~400 lines)

### Functions to Move

| Function | Line | Dependencies |
|----------|------|--------------|
| `ensureHiddenSessionsContainer` | 73 | None (already in state.ts) |
| `enterTheatreMode` | 2314 | Multiple - orchestrates all modules |
| `exitTheatreMode` | 2537 | Multiple - orchestrates cleanup |
| `destroyTheatreSessions` | 2653 | `projectSessions` |
| `getPreservedSessionPaths` | 2677 | `projectSessions` |
| `hasPreservedSession` | 2684 | `projectSessions` |
| `isInTheatreMode` | 2691 | `theatreState.projectPath` |

---

## Step 8: Update terminalComponent.ts

After extraction, terminalComponent.ts should only contain:

### Keep in terminalComponent.ts (~400 lines)

| Function | Line | Purpose |
|----------|------|---------|
| `TerminalInstance` interface | 13-20 | Non-theatre terminal type |
| `terminals` Map | 23 | Non-theatre terminal storage |
| `createTerminalContainer` | 124 | Creates terminal accordion UI |
| `getTerminalTheme` | 167 | Terminal color theme |
| `createTerminal` | 426 | Creates non-theatre terminal |
| `destroyTerminal` | 567 | Destroys non-theatre terminal |
| `hasTerminal` | 606 | Checks if terminal exists |
| `getOpenTerminalPaths` | 613 | Lists open terminals |
| `reattachTerminal` | 621 | Reattaches after DOM refresh |
| `destroyAllTerminals` | 640 | Cleanup all terminals |

### Re-exports

```typescript
// Re-export theatre mode functions for backwards compatibility
export {
  enterTheatreMode,
  exitTheatreMode,
  destroyTheatreSessions,
  getPreservedSessionPaths,
  hasPreservedSession,
  isInTheatreMode
} from './theatre';
```

---

## Step 9: Create theatre/index.ts

```typescript
// src/components/theatre/index.ts
export * from './state';
export * from './gitStatus';
export * from './diffPanel';
export * from './tasksPanel';
export * from './launchDropdown';
export * from './terminalCards';
export * from './theatreMode';
```

---

## Circular Dependency Resolution

Several modules have circular dependencies. Resolve using dependency injection during initialization:

```typescript
// In theatreMode.ts, after imports:
import { setToggleDiffPanel } from './diffPanel';
import { setAddTheatreTerminal } from './tasksPanel';
import { toggleDiffPanel } from './diffPanel';
import { addTheatreTerminal } from './terminalCards';

// Initialize cross-module references
setToggleDiffPanel(toggleDiffPanel);
setAddTheatreTerminal(addTheatreTerminal);
```

---

## Implementation Order

Execute in this order to minimize broken states:

1. **Update state.ts** - Ensure all needed types/constants are exported
2. **Migrate state references** - Update terminalComponent.ts to use `theatreState.*`
3. **Extract gitStatus.ts** - Most self-contained
4. **Extract diffPanel.ts** - Only needs gitStatus for toggleDiffPanel injection
5. **Extract terminalCards.ts** - Needed by tasksPanel and launchDropdown
6. **Extract tasksPanel.ts** - Needs terminalCards
7. **Extract launchDropdown.ts** - Needs terminalCards
8. **Extract theatreMode.ts** - Orchestrates everything
9. **Create index.ts** - Barrel exports
10. **Clean up terminalComponent.ts** - Remove extracted code, add re-exports

---

## Verification Checklist

After each module extraction:

1. [ ] `npm start` - App launches without errors
2. [ ] Theatre mode enters/exits properly
3. [ ] Terminal cards display and switch correctly
4. [ ] Git status shows and dropdown works
5. [ ] Branch switching works
6. [ ] Diff panel opens and displays changes
7. [ ] File selector dropdown works
8. [ ] Tasks panel opens and lists tasks
9. [ ] Launching Claude for a task works
10. [ ] Launch dropdown shows commands
11. [ ] Multiple terminals can be opened
12. [ ] Session preservation works (switch projects, come back)

---

## Notes

- **Icons**: Each module should import only the Lucide icons it needs
- **showToast**: Import from `../importDialog` where needed
- **window.api**: IPC calls can remain as-is
- **createIcons**: Call after inserting HTML with icons
- **DOM queries**: Use consistent selectors (class names won't change)
