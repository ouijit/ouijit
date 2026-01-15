# Code Health Refactoring Plan

## Overview

This plan addresses low-hanging fruit for improving maintainability of the Ouijit codebase. The focus is on reducing duplication, improving modularity, and making the code easier to navigate and extend.

## Progress

- [x] Extract shared utilities (#2)
- [x] Consolidate git exec options (#4)
- [x] Extract dropdown pattern (#3) - utility created, not yet integrated
- [x] Create shared theatre state module - foundation for future split
- [x] Create barrel exports (#5) - utils only
- [ ] Split terminalComponent.ts (#1) - deferred due to tight coupling

---

## 1. Split terminalComponent.ts (2732 lines)

**Problem:** The file is massive and handles too many responsibilities - terminal management, theatre mode, git UI, diff panel, tasks panel, dropdowns, and output parsing.

**Solution:** Extract into focused modules:

| New File | Responsibilities | Est. Lines |
|----------|-----------------|------------|
| `components/theatre/theatreMode.ts` | Enter/exit theatre mode, header, session storage | ~400 |
| `components/theatre/terminalCards.ts` | Multi-terminal card UI, switching, output analysis | ~300 |
| `components/theatre/gitStatus.ts` | Git status display, branch dropdown, merge button | ~350 |
| `components/theatre/diffPanel.ts` | Diff panel, file selector, diff rendering | ~300 |
| `components/theatre/tasksPanel.ts` | Tasks panel, task-terminal linking | ~200 |
| `components/theatre/launchDropdown.ts` | Command dropdown for theatre mode | ~150 |
| `components/terminalComponent.ts` | Core terminal creation/destruction (keep focused) | ~400 |

**Files to modify:**
- `src/components/terminalComponent.ts` - refactor
- Create 6 new files in `src/components/theatre/`

---

## 2. Extract Shared Utilities

**Problem:** Duplicated utility functions across files.

### 2a. Run Config Utilities
`getConfigId`, `customCommandsToRunConfigs`, `mergeRunConfigs` are duplicated in:
- `src/components/terminalComponent.ts:124-152`
- `src/components/projectRow.ts:11-40`

**Solution:** Create `src/utils/runConfigs.ts`

```typescript
export function getConfigId(config: RunConfig): string {
  return config.isCustom ? config.name : `${config.source}:${config.name}`;
}

export function customCommandsToRunConfigs(customCommands: CustomCommand[]): RunConfig[] {
  return customCommands.map(cmd => ({
    name: cmd.name,
    command: cmd.command,
    source: 'custom' as const,
    description: cmd.description,
    priority: 0,
    isCustom: true,
  }));
}

export function mergeRunConfigs(
  detectedConfigs: RunConfig[] | undefined,
  customCommands: CustomCommand[]
): RunConfig[] {
  const customConfigs = customCommandsToRunConfigs(customCommands);
  const detected = detectedConfigs || [];
  return [...customConfigs, ...detected];
}
```

### 2b. Date Formatting
`formatRelativeTime` (projectRow.ts:81-107) and `formatAge` (git.ts:200-213) do similar work.

**Solution:** Create `src/utils/formatDate.ts`

```typescript
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  if (diffDays < 7) return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  if (diffWeeks < 4) return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
  if (diffMonths < 12) return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
  return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
}

export function formatAge(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months}mo`;
  if (weeks > 0) return `${weeks}w`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'now';
}
```

### 2c. HTML Utilities
`escapeHtml` only exists in terminalComponent.ts but is useful elsewhere.

**Solution:** Create `src/utils/html.ts`

```typescript
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**Files to modify:**
- Create `src/utils/runConfigs.ts`
- Create `src/utils/formatDate.ts`
- Create `src/utils/html.ts`
- Update imports in `projectRow.ts`, `terminalComponent.ts`, `git.ts`

---

## 3. Extract Dropdown Pattern

**Problem:** Three nearly identical dropdown implementations (git, launch, diff file) with duplicate show/hide/toggle logic.

**Current pattern (repeated 3x in terminalComponent.ts):**
```typescript
let dropdownVisible = false;
let dropdownCleanup: (() => void) | null = null;

function showDropdown() {
  if (dropdownVisible) return;
  // Create DOM, add handlers, set up click-outside
  dropdownVisible = true;
  const handleClickOutside = (e: MouseEvent) => { ... };
  setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
  dropdownCleanup = () => document.removeEventListener('click', handleClickOutside);
}

function hideDropdown() {
  if (!dropdownVisible) return;
  // Remove visibility class, clean up, remove element
  dropdownCleanup?.();
  dropdownCleanup = null;
  dropdownVisible = false;
}

function toggleDropdown() {
  if (dropdownVisible) hideDropdown();
  else showDropdown();
}
```

**Solution:** Create `src/utils/dropdown.ts`

```typescript
interface DropdownOptions {
  getAnchor: () => Element | null;
  buildContent: (container: HTMLElement) => Promise<void> | void;
  className: string;
  onHide?: () => void;
}

interface DropdownManager {
  show(): Promise<void>;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
}

export function createDropdownManager(options: DropdownOptions): DropdownManager {
  let visible = false;
  let cleanup: (() => void) | null = null;

  return {
    async show() {
      if (visible) return;
      const anchor = options.getAnchor();
      if (!anchor) return;

      let dropdown = anchor.querySelector(`.${options.className}`) as HTMLElement;
      if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = options.className;
        anchor.appendChild(dropdown);
      }

      await options.buildContent(dropdown);

      requestAnimationFrame(() => dropdown.classList.add('visible'));
      visible = true;

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!anchor.contains(target)) {
          this.hide();
        }
      };

      setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
      cleanup = () => document.removeEventListener('click', handleClickOutside);
    },

    hide() {
      if (!visible) return;
      const anchor = options.getAnchor();
      const dropdown = anchor?.querySelector(`.${options.className}`);
      if (dropdown) {
        dropdown.classList.remove('visible');
        setTimeout(() => dropdown.remove(), 150);
      }
      cleanup?.();
      cleanup = null;
      visible = false;
      options.onHide?.();
    },

    toggle() {
      if (visible) this.hide();
      else this.show();
    },

    isVisible() {
      return visible;
    }
  };
}
```

**Usage becomes:**
```typescript
const gitDropdown = createDropdownManager({
  getAnchor: () => document.querySelector('.theatre-git-branch-zone'),
  buildContent: async (el) => { el.innerHTML = buildGitDropdownHtml(info); },
  className: 'theatre-git-dropdown',
});

// Then: gitDropdown.toggle(), gitDropdown.hide(), etc.
```

---

## 4. Consolidate Git Exec Options

**Problem:** Same `execSync` options repeated in every function in `git.ts`:
```typescript
const opts = { cwd: projectPath, encoding: 'utf8' as const, stdio: ['pipe', 'pipe', 'pipe'] as const };
```

This appears 15+ times throughout the file.

**Solution:** Extract to helper at top of `src/git.ts`:

```typescript
function gitExecOpts(projectPath: string) {
  return {
    cwd: projectPath,
    encoding: 'utf8' as const,
    stdio: ['pipe', 'pipe', 'pipe'] as const
  };
}

// Usage:
const opts = gitExecOpts(projectPath);
```

**File to modify:** `src/git.ts` (single location fix)

---

## 5. Optional: Create Components Index

**Problem:** Many imports scattered across files.

**Solution:** Create barrel exports:

```typescript
// src/components/index.ts
export * from './projectRow';
export * from './projectGrid';
export * from './terminalComponent';
export * from './importDialog';
export * from './customCommandDialog';
export * from './newProjectDialog';
export * from './searchBar';
```

```typescript
// src/utils/index.ts
export * from './projectIcon';
export * from './runConfigs';
export * from './formatDate';
export * from './html';
export * from './dropdown';
```

---

## Priority Order

1. **Extract shared utilities (#2)** - Low risk, immediate deduplication, ~30 min
2. **Consolidate git exec options (#4)** - Quick win, single file, ~10 min
3. **Split terminalComponent.ts (#1)** - Highest impact, most involved, ~2-3 hours
4. **Extract dropdown pattern (#3)** - Nice abstraction, moderate effort, ~45 min
5. **Create component index (#5)** - Optional cleanup, ~15 min

---

## Verification

After each refactoring step:
1. Run `npm run start` to verify the app launches
2. Test affected features manually:
   - Project list loads and displays correctly
   - Theatre mode enters/exits properly
   - Git status displays and dropdown works
   - Diff panel opens and shows changes
   - Tasks panel functions correctly
   - Terminal commands execute properly
3. Check for TypeScript errors: `npx tsc --noEmit`

---

## Files Summary

**Created files:**
- `src/utils/runConfigs.ts` ✓
- `src/utils/formatDate.ts` ✓
- `src/utils/html.ts` ✓
- `src/utils/dropdown.ts` ✓
- `src/utils/index.ts` ✓
- `src/components/theatre/state.ts` ✓ (shared state foundation)

**Remaining files to create:**
- `src/components/theatre/theatreMode.ts`
- `src/components/theatre/terminalCards.ts`
- `src/components/theatre/gitStatus.ts`
- `src/components/theatre/diffPanel.ts`
- `src/components/theatre/tasksPanel.ts`
- `src/components/theatre/launchDropdown.ts`
- `src/components/index.ts` (optional)

**Modified files:**
- `src/components/terminalComponent.ts` - removed duplicated utilities ✓
- `src/components/projectRow.ts` - updated imports ✓
- `src/git.ts` - consolidated exec options, use shared formatAge ✓
