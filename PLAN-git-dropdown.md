# Plan: Git Status Dropdown in Theatre Mode Header

## Design Reference
**Follow the existing dropdown pattern in the codebase:**
- See `src/components/projectRow.ts` - `createLaunchDropdown()` function for implementation pattern
- See `src/index.css` - `.launch-dropdown`, `.launch-option`, `.launch-dropdown-divider` classes for styling

Key patterns to follow:
- Use `.visible` class to toggle dropdown visibility
- Use `position: absolute; top: 100%; right: 0;` positioning
- Use CSS transitions for opacity/transform animations
- Close dropdown on click outside (global click listener)
- Use `e.stopPropagation()` on dropdown item clicks

## Overview
Enhance the existing git status pill in theatre mode header to be clickable, revealing a dropdown with:
- Current branch: ahead/behind remote + uncommitted changes summary
- Recent branches: commits ahead of main + time since last commit

## Target UI

```
┌─────────────────────────────────────┐
│ main                        ↑2 ↓1  │  ← current branch, ahead/behind remote
│ 3 files · +47 -12                  │  ← uncommitted changes
├─────────────────────────────────────┤
│ feature/auth              +12 · 2d │  ← 12 commits ahead of main, 2 days ago
│ fix/login-bug              +3 · 5h │
│ refactor/api              +24 · 1w │
└─────────────────────────────────────┘
```

## Current State
- `src/git.ts` has basic `getGitStatus()` returning `{ branch, isDirty }`
- Theatre header shows a git status pill with branch name and colored dot
- No dropdown functionality exists yet

## Implementation Steps

### 1. Extend Git Utilities
**File:** `src/git.ts`

Add new interfaces:
```typescript
export interface UncommittedChanges {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ExtendedGitStatus {
  branch: string;
  ahead: number;
  behind: number;
  uncommitted: UncommittedChanges | null;
}

export interface RecentBranch {
  name: string;
  commitsAhead: number;
  lastCommitAge: string; // "2d", "5h", "1w"
}

export interface GitDropdownInfo {
  current: ExtendedGitStatus;
  recentBranches: RecentBranch[];
  mainBranch: string;
}
```

Add new function `getGitDropdownInfo(projectPath: string): GitDropdownInfo | null`:

**Git commands needed:**
- Current branch: `git rev-parse --abbrev-ref HEAD`
- Ahead/behind remote: `git rev-list --left-right --count HEAD...@{upstream}`
- Uncommitted changes: `git diff --shortstat HEAD` (parse "3 files changed, 47 insertions(+), 12 deletions(-)")
- Detect main branch: try `git rev-parse --verify main`, fallback to `master`
- Recent branches: `git for-each-ref --sort=-committerdate --format='%(refname:short)|%(committerdate:unix)' refs/heads/ --count=7`
- Commits ahead of main per branch: `git rev-list --count main..branch-name`

**Helper functions to add:**
- `getMainBranch(projectPath)` - detect "main" or "master"
- `getAheadBehind(projectPath)` - returns `{ ahead, behind }`
- `getUncommittedChanges(projectPath)` - returns `UncommittedChanges | null`
- `formatAge(seconds)` - converts seconds to "2d", "5h", etc.
- `getRecentBranches(projectPath, currentBranch, mainBranch, limit)` - returns `RecentBranch[]`

### 2. Add Types
**File:** `src/types.ts`

Export the new interfaces (or re-export from git.ts):
```typescript
export type { GitDropdownInfo, ExtendedGitStatus, RecentBranch, UncommittedChanges } from './git';
```

Update `ElectronAPI` interface:
```typescript
getGitDropdownInfo(projectPath: string): Promise<GitDropdownInfo | null>;
```

### 3. Add IPC Handler
**File:** `src/ipc.ts`

Import `getGitDropdownInfo` from `./git`

Add handler:
```typescript
ipcMain.handle('get-git-dropdown-info', async (_event, projectPath: string) => {
  return getGitDropdownInfo(projectPath);
});
```

### 4. Add Preload Bridge
**File:** `src/preload.ts`

Add method:
```typescript
getGitDropdownInfo: (projectPath: string): Promise<GitDropdownInfo | null> =>
  ipcRenderer.invoke('get-git-dropdown-info', projectPath),
```

### 5. Update Terminal Component
**File:** `src/components/terminalComponent.ts`

**5a. Add dropdown state:**
```typescript
let gitDropdownVisible = false;
let gitDropdownCleanup: (() => void) | null = null;
```

**5b. Update `buildGitStatusHtml()` to make it clickable:**
- Add `theatre-git-status--clickable` class
- Add `role="button"` and `tabindex="0"`

**5c. Add new function `buildGitDropdownHtml(info: GitDropdownInfo): string`:**
- Render current branch section with ahead/behind arrows (↑↓)
- Render uncommitted changes line if present
- Render divider
- Render recent branches list

**5d. Add function `showGitDropdown(projectPath: string)`:**
- Fetch `gitDropdownInfo` via `window.api.getGitDropdownInfo(projectPath)`
- Create dropdown element and insert after git status pill
- Add `.visible` class to show (mirrors `launch-dropdown` pattern)
- **Pattern reference:** See `createLaunchDropdown()` in `projectRow.ts` lines 86-165

**5e. Add function `hideGitDropdown()`:**
- Remove `.visible` class from dropdown
- **Pattern reference:** See click handler in `projectRow.ts` lines 295-304

**5f. Wire up click handler in `enterTheatreMode()`:**
- After creating header, attach click handler to `.theatre-git-status`
- Toggle dropdown visibility using `.visible` class
- **Pattern reference:** Same toggle pattern as launch button in `projectRow.ts`

**5g. Add global click listener to close dropdown:**
- **Pattern reference:** See `projectRow.ts` lines 341-343 for existing global click-outside handler

**5h. Update `exitTheatreMode()` to clean up dropdown**

### 6. Add CSS Styles
**File:** `src/index.css`

**NOTE:** Base dropdown styles should mirror `.launch-dropdown` for consistency. Reference existing styles at lines 617-639 in index.css.

```css
/* Clickable git status */
.theatre-git-status--clickable {
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.theatre-git-status--clickable:hover {
  background: var(--color-border);
}

/* Git dropdown - mirrors .launch-dropdown pattern */
.theatre-git-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--spacing-xs);
  min-width: 260px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  overflow: hidden;
  -webkit-app-region: no-drag;
  /* Animation - same as .launch-dropdown */
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px);
  transition: all var(--transition-fast);
}

.theatre-git-dropdown.visible {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.git-dropdown-current {
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
}

.git-dropdown-branch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.git-dropdown-branch-name {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.git-dropdown-ahead-behind {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  display: flex;
  gap: 8px;
}

.git-dropdown-ahead-behind .ahead {
  color: #34C759;
}

.git-dropdown-ahead-behind .behind {
  color: #FF9F0A;
}

.git-dropdown-uncommitted {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.git-dropdown-uncommitted .insertions {
  color: #34C759;
}

.git-dropdown-uncommitted .deletions {
  color: #FF3B30;
}

.git-dropdown-recent {
  padding: 8px 0;
}

.git-dropdown-recent-header {
  padding: 4px 12px 8px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.git-dropdown-branch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  transition: background-color var(--transition-fast);
}

.git-dropdown-branch:hover {
  background: var(--color-background);
}

.git-dropdown-branch-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.git-dropdown-branch-stats {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
```

### 7. Update Idle Refresh
The existing idle refresh mechanism should also refresh dropdown info if the dropdown is open. Modify `refreshGitStatus()` to:
- Update the basic status pill
- If dropdown is visible, also refresh dropdown content

## Files to Modify
1. `src/git.ts` - add extended git functions
2. `src/types.ts` - add/export new types
3. `src/ipc.ts` - add handler
4. `src/preload.ts` - add bridge method
5. `src/components/terminalComponent.ts` - add dropdown UI
6. `src/index.css` - add dropdown styles

## Testing Checklist
1. Click git status pill → dropdown appears
2. Click outside dropdown → dropdown closes
3. Dropdown shows correct current branch with ahead/behind
4. Dropdown shows uncommitted changes when dirty
5. Dropdown shows recent branches (excluding current)
6. Recent branches show correct commits ahead of main
7. Recent branches show correct age (2d, 5h, etc.)
8. Dropdown updates after terminal activity (idle refresh)
9. Exiting theatre mode cleans up dropdown
10. Works for repos with no remote (ahead/behind should be 0/0)
11. Works for repos with no recent branches
12. Works when on main branch (don't show main in recent list)
