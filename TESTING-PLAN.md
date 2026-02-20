# Testing Plan

Goal: Add high-value tests that provide refactoring confidence with minimal maintenance burden. Fewer, comprehensive tests over exhaustive granular ones.

## Current Coverage

Already tested (good coverage):
- **taskMetadata.ts** - CRUD, status transitions, ordering, column reordering, schema migration
- **hookServer.ts** - HTTP server lifecycle, hook install/uninstall, Claude settings management
- **worktree.ts** - `startTask` and `removeTaskWorktree` (partial)
- **terminalCards.ts** - `resolveTerminalLabel` helper

Not tested:
- `git.ts` - Diff parsing, shortstat parsing, branch name utilities
- `worktree.ts` - `sanitizeBranchName`, `generateBranchName`, `validateBranchName`, `createTaskWorktree`, `listWorktrees`, CoW cloning
- `scanner.ts` - Project discovery, language detection, icon loading
- `projectSettings.ts` - Settings CRUD, hook management
- `hookRunner.ts` - Hook execution with timeout/output capture
- All renderer/UI components
- IPC handler orchestration (ipc.ts)
- Full user workflows (e2e)

## Strategy

Three tiers, in priority order:

### Tier 1: Pure Function Unit Tests

These are the highest ROI — fast, stable, zero mocking, and protect the logic most likely to break during refactors.

#### 1a. Git output parsing (`git.ts`)

Single test file: `src/__tests__/gitParsing.test.ts`

One comprehensive test per parser that covers realistic inputs including edge cases:

- **`parseDiff`** (unexported, test via `getFileDiff` or export for testing)
  - Multi-hunk diff with additions, deletions, context lines
  - Renamed file diff
  - Binary file (empty hunks)
  - Single-line change

- **`parseShortstat`**
  - Normal: `"3 files changed, 47 insertions(+), 12 deletions(-)"`
  - Insertions only: `"1 file changed, 5 insertions(+)"`
  - Deletions only: `"2 files changed, 10 deletions(-)"`
  - Empty string

Approach: These two functions need to be exported (or tested via their calling functions). Since `parseDiff` is called by `getFileDiff` and `getWorktreeFileDiff`, and those shell out to git, the cleanest approach is to export `parseDiff` and `parseShortstat` directly for testing. They're pure functions with no side effects.

#### 1b. Branch name utilities (`worktree.ts`)

Add to existing or new test file: `src/__tests__/branchNames.test.ts`

One test per function covering the interesting cases:

- **`sanitizeBranchName`**
  - Normal name: `"Add login page"` → `"add-login-page"`
  - Special chars: `"fix: bug #123"` → `"fix-bug-123"`
  - Leading/trailing spaces and hyphens
  - All-invalid chars → empty string

- **`generateBranchName`**
  - With name: `("Add login", 5)` → `"add-login-5"`
  - Empty/undefined name: `(undefined, 5)` → `"task-5"`
  - Name that sanitizes to empty: `("!!!", 3)` → `"task-3"`

#### 1c. Date formatting (`utils/formatDate.ts`)

Quick test: `src/__tests__/formatDate.test.ts`

- Test `formatAge` with representative values (seconds, minutes, hours, days, weeks)

### Tier 2: Data Layer Integration Tests

These test realistic multi-step workflows through the actual persistence layer. They catch bugs in state management, ordering, and data integrity.

#### 2a. Project settings lifecycle (`src/__tests__/projectSettings.test.ts`)

Single comprehensive test that exercises the full lifecycle:

1. Get settings for new project (returns defaults)
2. Save a `start` hook
3. Save a `run` hook
4. Get hooks — verify both present
5. Delete the `start` hook
6. Get hooks — verify only `run` remains
7. Set sandbox config
8. Get sandbox config — verify defaults merged with override
9. Set `killExistingOnRun`
10. Verify full settings object is correct

Mock: Only `electron` (same as existing tests — `app.getPath`)

#### 2b. Full task lifecycle integration (`src/__tests__/taskLifecycle.test.ts`)

Single test that walks through a realistic multi-task workflow:

1. Create 3 todo tasks
2. Verify ordering (0, 1, 2 in todo column)
3. Start task 1 (→ in_progress)
4. Reorder: drag task 3 to top of todo
5. Move task 2 to in_progress via status change
6. Verify both columns have correct order
7. Move task 1 to in_review
8. Move task 1 to done — verify closedAt set
9. Move task 1 back to in_progress — verify closedAt cleared
10. Delete task 3
11. Verify remaining tasks and ordering intact

This duplicates some coverage with existing tests but tests the *interactions* between operations, which is where refactoring bugs hide.

### Tier 3: E2E Tests

These provide the highest confidence for refactoring but are the most expensive to write and maintain. Use Playwright with Electron support.

#### Setup

```bash
npm install -D @playwright/test electron
```

Create `e2e/` directory at project root with:
- `e2e/playwright.config.ts` - Electron launch config
- `e2e/fixtures.ts` - Shared setup (temp project dirs, cleanup)
- `e2e/app.test.ts` - Main test file

The Playwright Electron integration launches the actual app binary and provides access to the Electron APIs and the renderer window. Each test creates temporary git repos in a temp directory and cleans up afterward.

#### 3a. Project discovery and navigation (`e2e/app.test.ts`)

Single test:

1. Create a temp directory with a git repo inside
2. Launch app with `OUIJIT_SCAN_DIRS` env var (or mock the scanner paths — we may need to add a test-only env var to override `PROJECT_DIRECTORIES`)
3. Verify the project appears in the grid
4. Click the project → enters project mode
5. Verify project mode UI is shown (terminal card visible)
6. Press Escape → returns to project grid
7. Verify project grid is shown again

#### 3b. Task creation and terminal flow (`e2e/app.test.ts`)

Single test continuing from above:

1. Enter project mode
2. Press Cmd+N → new task dialog appears
3. Type task name, submit
4. Verify task card appears in kanban
5. Click "Start" on the task → terminal opens with worktree
6. Verify terminal is functional (type `echo hello`, see output)
7. Verify git status shows the task branch
8. Toggle kanban view — verify task appears in "In Progress" column
9. Close terminal

#### 3c. Diff and merge flow (`e2e/app.test.ts`)

Single test:

1. Start a task (worktree created)
2. Make a file change in the worktree (via the terminal: `echo "change" > test.txt && git add . && git commit -m "test"`)
3. Open diff panel (Cmd+D) → verify diff shows the change
4. Ship the task → verify merge succeeds
5. Verify task moves to done

#### E2E implementation notes

- **Test isolation**: Each test creates a fresh temp directory with `git init`. Tests don't share state.
- **Timeouts**: Terminal operations need generous timeouts (5-10s) for PTY startup and output.
- **CI considerations**: E2E tests require a display server. On Linux CI, use `xvfb-run`. On macOS CI, it works natively.
- **Environment variable for scan paths**: Add `OUIJIT_TEST_SCAN_DIRS` to `scanner.ts` that overrides `PROJECT_DIRECTORIES` when set. This lets e2e tests control which projects are visible without touching the user's filesystem.

## Implementation Order

1. **Tier 1a + 1b** — Git parsing + branch name tests. ~30 min. Zero new dependencies. Immediate value.
2. **Tier 1c** — Date formatting. ~10 min. Trivial.
3. **Tier 2a** — Project settings lifecycle. ~30 min. Same test infrastructure as existing.
4. **Tier 2b** — Task lifecycle integration. ~30 min. Same infrastructure.
5. **Tier 3 setup** — Playwright + Electron config, fixtures, env var for scan paths. ~1 hour.
6. **Tier 3a** — Project discovery e2e. ~1 hour.
7. **Tier 3b** — Task creation e2e. ~1 hour.
8. **Tier 3c** — Diff/merge e2e. ~1 hour.

## What NOT to Test

Following the "high value, low maintenance" principle:

- **Individual UI component rendering** — DOM manipulation is tightly coupled to the app's specific layout. E2E tests cover this better.
- **IPC handler wiring** — `ipc.ts` is pure glue code. If the functions it calls work and the e2e tests pass, the wiring is correct.
- **Lima VM integration** — Requires a real Lima installation and VM. Not practical for automated testing. Manual testing only.
- **PTY manager internals** — Requires node-pty. Covered indirectly by e2e terminal tests.
- **Hotkey registration** — Brittle to test in isolation. Covered by e2e tests.

## File Changes Needed

### Exports for testability
- `src/git.ts`: Export `parseDiff` and `parseShortstat` (pure functions, no side effects)

### New env var
- `src/scanner.ts`: Check `process.env.OUIJIT_TEST_SCAN_DIRS` before using hardcoded `PROJECT_DIRECTORIES`

### New test files
- `src/__tests__/gitParsing.test.ts`
- `src/__tests__/branchNames.test.ts`
- `src/__tests__/formatDate.test.ts`
- `src/__tests__/projectSettings.test.ts`
- `src/__tests__/taskLifecycle.test.ts`

### New e2e infrastructure
- `e2e/playwright.config.ts`
- `e2e/fixtures.ts`
- `e2e/app.test.ts`

### Package.json scripts
- `"test:e2e": "playwright test --config e2e/playwright.config.ts"`
