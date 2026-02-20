---
title: "Testing Plan v2: Refactoring Safety with Agent-Parallel Execution"
type: feat
status: completed
date: 2026-02-20
origin: docs/brainstorms/2026-02-20-testing-plan-v2-brainstorm.md
---

# Testing Plan v2: Refactoring Safety with Agent-Parallel Execution

## Overview

Replace the current `TESTING-PLAN.md` with an improved testing plan that provides refactoring safety for the Ouijit desktop app, supports multiple AI agents running tests in parallel (in worktrees or VMs), and offers a fast/full test split for efficient development workflows.

## Problem Statement / Motivation

The existing testing plan has solid structure but gaps that become critical in a multi-agent environment:
- No test isolation guarantees for parallel execution (shared `userData`, no port conflict protection)
- No fast/full test split — agents either run everything or nothing
- E2E infrastructure doesn't exist yet and the plan underspecifies Electron process isolation
- Missing `_resetCacheForTesting()` in `projectSettings.ts` blocks data layer tests
- No agent testing guide — agents don't know when or how to add tests
- IPC boundary tests are mentioned but the mock surface area is underestimated

(see brainstorm: `docs/brainstorms/2026-02-20-testing-plan-v2-brainstorm.md`)

## Proposed Solution

A 3-tier testing plan with 4 implementation phases:

### Phase 1: Source Code Prerequisites

Changes to production code that unblock testing.

#### 1.1 Export git parsers from `src/git.ts`

Export `parseDiff` (line 566) and `parseShortstat` (line 670) as named exports. These are pure functions with no side effects — exporting them has zero risk.

```ts
// src/git.ts — change from:
function parseDiff(diffOutput: string): DiffHunk[] {
// to:
export function parseDiff(diffOutput: string): DiffHunk[] {

// Same for parseShortstat:
export function parseShortstat(shortstat: string): { files: number; insertions: number; deletions: number } {
```

#### 1.2 Add `_resetCacheForTesting()` to `src/projectSettings.ts`

Mirror the pattern from `taskMetadata.ts:98-100`:

```ts
// src/projectSettings.ts
export function _resetCacheForTesting(): void {
  settingsCache = null;
}
```

#### 1.3 Add `OUIJIT_TEST_SCAN_DIRS` to `src/scanner.ts`

At the top of `scanForProjects()`, check the env var and override `PROJECT_DIRECTORIES`:

```ts
// src/scanner.ts — inside scanForProjects()
const scanDirs = process.env.OUIJIT_TEST_SCAN_DIRS
  ? process.env.OUIJIT_TEST_SCAN_DIRS.split(':').map(expandTilde)
  : PROJECT_DIRECTORIES.map(expandTilde);
```

When set, also skip `getAddedProjects()` — E2E tests should fully control what the app sees.

#### 1.4 Add `OUIJIT_TEST_USER_DATA` to `src/main.ts`

Add early `userData` override so each E2E instance gets isolated metadata and settings:

```ts
// src/main.ts — after app import, before app.ready
if (process.env.OUIJIT_TEST_USER_DATA) {
  app.setPath('userData', process.env.OUIJIT_TEST_USER_DATA);
}
```

This is critical for parallel E2E safety — without it, multiple Electron instances write to the same `task-metadata.json` and `project-settings.json`.

### Phase 2: Tier 1 — Pure Function Unit Tests

Zero mocking, fast, high ROI. These protect the logic most likely to break during refactors.

#### 2.1 `src/__tests__/gitParsing.test.ts`

Test `parseDiff` and `parseShortstat` with realistic inputs:

**`parseDiff` cases:**
- Multi-hunk diff with additions, deletions, context lines
- Renamed file diff
- Binary file (empty hunks)
- Single-line change
- Empty string input

**`parseShortstat` cases:**
- Normal: `"3 files changed, 47 insertions(+), 12 deletions(-)"`
- Insertions only: `"1 file changed, 5 insertions(+)"`
- Deletions only: `"2 files changed, 10 deletions(-)"`
- Empty string

#### 2.2 `src/__tests__/branchNames.test.ts`

Test `sanitizeBranchName` and `generateBranchName` (already exported from `worktree.ts`):

**`sanitizeBranchName` cases:**
- Normal name: `"Add login page"` → `"add-login-page"`
- Special chars: `"fix: bug #123"` → `"fix-bug-123"`
- Leading/trailing spaces and hyphens
- All-invalid chars → empty string
- Unicode input

**`generateBranchName` cases:**
- With name: `("Add login", 5)` → `"add-login-5"`
- Empty/undefined name: `(undefined, 5)` → `"task-5"`
- Name that sanitizes to empty: `("!!!", 3)` → `"task-3"`

#### 2.3 `src/__tests__/formatDate.test.ts`

Test `formatAge` (pure, takes seconds):
- 0 seconds → `"now"`
- 300 → `"5m"`
- 7200 → `"2h"`
- 259200 → `"3d"`
- 604800 → `"1w"`
- 5184000 → `"2mo"`

### Phase 3: Tier 2 — Data Layer Integration Tests

Test realistic multi-step workflows through actual persistence. These use the existing Electron mock from `setup.ts`.

#### 3.1 `src/__tests__/projectSettings.test.ts`

Single comprehensive lifecycle test:

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

Uses `_resetCacheForTesting()` in `beforeEach`. Only mock needed: `electron` (already in `setup.ts`).

#### 3.2 `src/__tests__/taskLifecycle.test.ts`

Single test walking a realistic multi-task workflow:

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

This tests the *interactions* between operations — where refactoring bugs hide.

#### 3.3 IPC Boundary Tests — Descoped

**Decision: Drop IPC contract tests from this plan.**

The SpecFlow analysis revealed that `registerIpcHandlers()` calls into 8+ modules with native dependencies (`node-pty`, `koffi`, `nativeImage`) and starts the hook server on initialization. The mock surface area for even shape-only contract tests is enormous — you'd need to mock `ipcMain`, `BrowserWindow`, `child_process`, `fs/promises`, `koffi`, and all downstream modules.

The cost-benefit doesn't justify it for refactoring safety. The same seams are covered by:
- Tier 1 tests (the pure functions that handlers call)
- Tier 2 tests (the data layer that handlers orchestrate)
- Tier 3 E2E tests (the full handler chain end-to-end)

If IPC wiring breaks, the E2E tests catch it. If the underlying logic breaks, Tier 1/2 tests catch it. IPC contract tests would only catch the narrow case where handler registration itself is wrong — not worth the maintenance cost.

(see brainstorm: `docs/brainstorms/2026-02-20-testing-plan-v2-brainstorm.md` — originally proposed as Tier 2 item, descoped after SpecFlow analysis)

### Phase 4: Tier 3 — E2E Tests (Playwright + Electron)

#### 4.0 Infrastructure Setup

**Install dependencies:**
```bash
npm install -D @playwright/test
```

**Create `e2e/playwright.config.ts`:**
Configure Electron launch, global setup/teardown, timeouts. Key settings:
- Use `_electron.launch()` pointing at the Vite-built main script
- Set `OUIJIT_TEST_SCAN_DIRS` and `OUIJIT_TEST_USER_DATA` env vars per worker
- Global timeout: 30s per test
- Retries: 0 (flaky e2e tests should be fixed, not retried)

**Create `e2e/fixtures.ts`:**
Shared test fixture providing:
- `createTestRepo()` — creates a temp dir, runs `git init`, makes an initial commit, optionally creates branches. Returns `{ path, cleanup }`.
- `launchApp(scanDirs)` — launches Electron with isolated `userData` and `OUIJIT_TEST_SCAN_DIRS`. Returns the Playwright `ElectronApplication` and `Page`.
- `cleanupApp()` — kills Electron, cleans up temp dirs and any orphaned PTY processes.

**Create `e2e/app.test.ts`:**
Main test file with one Electron instance per file (`beforeAll`/`afterAll`).

**Add package.json scripts:**
```json
{
  "test:e2e": "npx playwright test --config e2e/playwright.config.ts",
  "test:full": "vitest run && npx playwright test --config e2e/playwright.config.ts"
}
```

**Linux headless support:**
E2E tests require a display server. On Linux CI, prefix with `xvfb-run`:
```json
{
  "test:e2e:ci": "xvfb-run npx playwright test --config e2e/playwright.config.ts"
}
```

#### 4.1 Project Discovery and Navigation (`e2e/app.test.ts`)

1. Create a temp directory with a git repo inside
2. Launch app with `OUIJIT_TEST_SCAN_DIRS` pointing to temp dir
3. Verify the project appears in the grid
4. Click the project → enters project mode
5. Verify project mode UI is shown (terminal card visible)
6. Press Escape → returns to project grid
7. Verify project grid is shown again

#### 4.2 Task Creation and Terminal Flow (`e2e/app.test.ts`)

1. Enter project mode
2. Press Cmd+N → new task dialog appears
3. Type task name, submit
4. Verify task card appears in kanban
5. Click "Start" on the task → terminal opens with worktree
6. Verify terminal is functional (type `echo hello`, see output)
7. Verify git status shows the task branch
8. Toggle kanban view — verify task appears in "In Progress" column
9. Close terminal

#### 4.3 Diff and Merge Flow (`e2e/app.test.ts`)

1. Start a task (worktree created)
2. Make a file change in the worktree via terminal
3. Open diff panel (Cmd+D) → verify diff shows the change
4. Ship the task → verify merge succeeds
5. Verify task moves to done

#### E2E Isolation Guarantees

| Resource | Isolation mechanism |
|----------|-------------------|
| Project discovery | `OUIJIT_TEST_SCAN_DIRS` env var per instance |
| Task metadata | `OUIJIT_TEST_USER_DATA` env var per instance → unique temp dir |
| Project settings | Same `userData` isolation |
| Hook server port | `listen(0)` — OS-assigned ephemeral port per process |
| Git repos | `mkdtemp()` — unique temp dir per test |
| PTY processes | Killed during `cleanupApp()` |
| Display server | `xvfb-run` on Linux CI; native on macOS |

#### E2E Failure Handling

- **Timeout handling:** Playwright's built-in test timeout (30s) kills the test. `afterAll` cleanup runs regardless.
- **Zombie process protection:** `cleanupApp()` sends SIGTERM to the Electron process, waits 3s, then SIGKILL. Also runs `pkill -f` for any orphaned PTY child processes matching the test's temp dir.
- **Test failure artifacts:** Playwright captures screenshots on failure. Configure `outputDir: 'e2e/results'` for debugging.

## Test Commands

| Command | What it runs | Target time | When to use |
|---------|-------------|-------------|-------------|
| `npm test` | Vitest (Tier 1 + Tier 2) | <15 seconds | After every code change |
| `npm run test:e2e` | Playwright (Tier 3) | <2 minutes | Before committing |
| `npm run test:full` | Vitest + Playwright | <2.5 minutes | Before creating a PR |
| `npm run test:e2e:ci` | Playwright with xvfb | <2 minutes | CI on Linux |

## Agent Testing Guide

Rules for AI agents modifying this codebase:

1. **Always run `npm test` before committing.** If tests fail, fix the failure before proceeding.
2. **Always run `npm run test:full` before creating a PR.**
3. **If you modify a pure function that has tests, run the tests first** to ensure you understand the current behavior.
4. **If you add a new pure function, add a test.** Follow existing patterns in `src/__tests__/`. No test file should require more mocking than `electron` (from `setup.ts`).
5. **If you modify data persistence** (`taskMetadata.ts`, `projectSettings.ts`), run the integration tests and verify data roundtrips correctly.
6. **Use unique project paths per test** (e.g., `'/test/my-specific-scenario'`) to avoid cross-test contamination.
7. **Never modify `src/__tests__/setup.ts`** without understanding the impact on all test files.
8. **Run tests from the repo root**, not from a worktree, unless `node_modules` is confirmed present in the worktree.

## What NOT to Test

- **Individual UI component rendering** — DOM manipulation is tightly coupled to the layout. E2E covers this.
- **IPC handler wiring** — Pure glue code. Mock surface area is enormous. Covered by Tier 1/2 (logic) + Tier 3 (wiring).
- **Lima VM integration** — Requires real Lima installation. Manual testing only.
- **PTY manager internals** — Requires `node-pty`. Covered by E2E terminal tests.
- **Hotkey registration** — Brittle in isolation. Covered by E2E.
- **`hookRunner.ts`** — Process spawning with timeout logic. Too integration-heavy to unit test well.
- **`scanner.ts`** — Filesystem traversal + `nativeImage`. E2E covers the critical path.

## Acceptance Criteria

- [x] `parseDiff` and `parseShortstat` exported from `src/git.ts`
- [x] `_resetCacheForTesting()` added to `src/projectSettings.ts`
- [x] `OUIJIT_TEST_SCAN_DIRS` env var added to `src/scanner.ts`
- [x] `OUIJIT_TEST_USER_DATA` env var added to `src/main.ts`
- [x] Tier 1 tests pass: `gitParsing.test.ts`, `branchNames.test.ts`, `formatDate.test.ts`
- [x] Tier 2 tests pass: `projectSettings.test.ts`, `taskLifecycle.test.ts`
- [x] `npm test` completes in <15 seconds (2.57s)
- [x] Playwright + Electron e2e infrastructure is set up
- [x] E2E tests updated with correct selectors matching actual UI (requires macOS host to run — cannot run in Lima VM due to native module platform mismatch)
- [ ] `npm run test:full` completes in <2.5 minutes (requires e2e to pass on macOS host)
- [ ] Two agents can run `npm run test:full` simultaneously without interference (requires e2e to pass on macOS host)
- [x] Agent testing guide is documented in the plan
- [x] Old `TESTING-PLAN.md` is replaced with this plan

## File Changes Summary

### Modified files
- `src/git.ts` — export `parseDiff`, `parseShortstat`
- `src/projectSettings.ts` — add `_resetCacheForTesting()`
- `src/scanner.ts` — add `OUIJIT_TEST_SCAN_DIRS` check
- `src/main.ts` — add `OUIJIT_TEST_USER_DATA` check
- `package.json` — add `test:e2e`, `test:full`, `test:e2e:ci` scripts; add `@playwright/test` devDependency

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

## Implementation Order

1. **Phase 1** — Source code prerequisites (export functions, add env vars, add cache reset)
2. **Phase 2** — Tier 1 pure function tests (git parsing, branch names, date formatting)
3. **Phase 3** — Tier 2 data layer tests (project settings lifecycle, task lifecycle)
4. **Phase 4** — Tier 3 e2e infrastructure + tests (Playwright setup, fixtures, 3 test scenarios)

Phases 2 and 3 can be parallelized — they are independent. Phase 1 must complete first. Phase 4 depends on Phase 1 (env vars).

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-02-20-testing-plan-v2-brainstorm.md](docs/brainstorms/2026-02-20-testing-plan-v2-brainstorm.md) — key decisions: keep 3-tier structure, full e2e plan, fast/full split, env var isolation, agent testing guide, descope hookRunner/scanner
- **Existing tests:** `src/__tests__/` — patterns for mocking, isolation, cache reset
- **SpecFlow analysis:** Identified critical gaps in E2E userData isolation and IPC contract test feasibility, leading to IPC boundary tests being descoped
