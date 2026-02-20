# Testing Plan

Goal: Provide refactoring safety with minimal maintenance burden, supporting multiple AI agents running tests in parallel.

## Test Commands

| Command | What it runs | Target time | When to use |
|---------|-------------|-------------|-------------|
| `npm test` | Vitest (Tier 1 + Tier 2) | <15 seconds | After every code change |
| `npm run test:e2e` | Playwright (Tier 3) | <2 minutes | Before committing |
| `npm run test:full` | Vitest + Playwright | <2.5 minutes | Before creating a PR |
| `npm run test:e2e:ci` | Playwright with xvfb | <2 minutes | CI on Linux |

## Current Coverage

Already tested:
- **taskMetadata.ts** - CRUD, status transitions, ordering, column reordering, schema migration
- **hookServer.ts** - HTTP server lifecycle, hook install/uninstall, Claude settings management
- **worktree.ts** - `startTask`, `removeTaskWorktree`, `sanitizeBranchName`, `generateBranchName`
- **terminalCards.ts** - `resolveTerminalLabel` helper
- **git.ts** - `parseDiff`, `parseShortstat` (multi-hunk, single-line, binary, empty, shortstat variants)
- **projectSettings.ts** - Full lifecycle (hooks CRUD, sandbox config, killExistingOnRun, cache reset)
- **taskMetadata.ts** - Multi-task lifecycle integration (create, reorder, status transitions, delete interactions)
- **utils/formatDate.ts** - `formatAge` (seconds, minutes, hours, days, weeks, months)

## Strategy

Three tiers, in priority order:

### Tier 1: Pure Function Unit Tests

Highest ROI — fast, stable, zero mocking.

**Files:**
- `src/__tests__/gitParsing.test.ts` - `parseDiff` and `parseShortstat`
- `src/__tests__/branchNames.test.ts` - `sanitizeBranchName` and `generateBranchName`
- `src/__tests__/formatDate.test.ts` - `formatAge`

### Tier 2: Data Layer Integration Tests

Realistic multi-step workflows through actual persistence.

**Files:**
- `src/__tests__/projectSettings.test.ts` - Full settings lifecycle with cache isolation
- `src/__tests__/taskLifecycle.test.ts` - Multi-task workflow testing interactions between operations

### Tier 3: E2E Tests (Playwright + Electron)

Highest confidence for refactoring, most expensive to maintain.

**Infrastructure:**
- `e2e/playwright.config.ts` - Electron launch config
- `e2e/fixtures.ts` - Shared fixtures (temp git repos, app launch, cleanup)
- `e2e/app.test.ts` - Main test file

**Scenarios:**
1. **Project discovery and navigation** - App discovers test repo, enters project mode, returns to grid
2. **Task creation and terminal flow** - Creates task via Cmd+N, verifies kanban
3. **Diff and merge flow** - Creates task, makes changes, verifies diff

**Test isolation for parallel agents:**

| Resource | Isolation mechanism |
|----------|-------------------|
| Project discovery | `OUIJIT_TEST_SCAN_DIRS` env var per instance |
| Task metadata | `OUIJIT_TEST_USER_DATA` env var → unique temp dir |
| Project settings | Same `userData` isolation |
| Hook server port | `listen(0)` — OS-assigned ephemeral port |
| Git repos | `mkdtemp()` — unique temp dir per test |

## Agent Testing Guide

Rules for AI agents modifying this codebase:

1. **Always run `npm test` before committing.** Fix failures before proceeding.
2. **Always run `npm run test:full` before creating a PR.**
3. **If you modify a pure function that has tests, run the tests first.**
4. **If you add a new pure function, add a test.** Follow patterns in `src/__tests__/`.
5. **If you modify data persistence** (`taskMetadata.ts`, `projectSettings.ts`), run the integration tests.
6. **Use unique project paths per test** (e.g., `'/test/my-specific-scenario'`).
7. **Never modify `src/__tests__/setup.ts`** without understanding the impact on all tests.
8. **Run tests from the repo root**, not from a worktree, unless `node_modules` is confirmed present.

## What NOT to Test

- **Individual UI component rendering** — E2E covers this
- **IPC handler wiring** — Mock surface area is enormous (8+ modules with native deps). Covered by Tier 1/2 (logic) + Tier 3 (wiring)
- **Lima VM integration** — Requires real installation. Manual testing only
- **PTY manager internals** — Requires `node-pty`. Covered by E2E
- **Hotkey registration** — Brittle in isolation. Covered by E2E
- **hookRunner.ts** — Process spawning with timeout. Too integration-heavy
- **scanner.ts** — Filesystem traversal + `nativeImage`. E2E covers critical path

## Source Changes for Testability

- `src/git.ts` - Exported `parseDiff` and `parseShortstat`
- `src/projectSettings.ts` - Added `_resetCacheForTesting()`
- `src/scanner.ts` - Added `OUIJIT_TEST_SCAN_DIRS` env var check
- `src/main.ts` - Added `OUIJIT_TEST_USER_DATA` env var check
- `vitest.config.ts` - Excluded `e2e/` directory
- `package.json` - Added `test:e2e`, `test:full`, `test:e2e:ci` scripts; `@playwright/test` devDependency
