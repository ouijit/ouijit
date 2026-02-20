---
title: "Adding comprehensive testing strategy to Electron app with native dependencies and parallel AI agent support"
date: 2026-02-20
category: integration-issues
tags:
  - testing
  - vitest
  - playwright
  - electron
  - native-dependencies
  - test-isolation
  - parallel-testing
  - node-pty
  - koffi
  - ipc
  - ai-agents
  - infrastructure
component: src/__tests__/
severity: high
time_to_resolve: "4-6 hours"
symptoms:
  - "No automated tests existed for the codebase"
  - "No way for AI agents to validate changes before committing"
  - "No regression safety net for refactoring"
  - "No test isolation mechanism for multiple agents working in parallel"
  - "Native dependencies crash when loaded in test environments"
root_cause: "Electron app had zero testing infrastructure, compounded by native dependencies and tightly coupled IPC making conventional test approaches impractical"
affects_versions: all
---

# Testing Strategy for Electron App with Native Dependencies

## Problem

Ouijit is an Electron desktop app with heavy native dependencies (node-pty, koffi, nativeImage), vanilla DOM manipulation, and a tightly coupled IPC layer that registers 8+ modules through a single handler file. These characteristics make traditional unit testing approaches fail immediately — importing any module that touches native code crashes the test runner, and the IPC coupling means mock surface area is enormous. The codebase also needs to support parallel AI agent execution, requiring test isolation at every resource boundary.

## Investigation

Several approaches were considered:

1. **Full mocking of native modules** — Rejected. The mock surface area is too large. Mocking node-pty, koffi, and Electron's nativeImage across every transitive import would create brittle tests that test mock behavior rather than real behavior. Every refactor would break mocks rather than catching real bugs.

2. **Jest with moduleNameMapper** — Considered for blanket module replacement, but Vitest (already in the stack) handles this better with native ESM support and Vite integration. Adding Jest would introduce a second test runner.

3. **Testing through IPC handler integration tests** — Rejected. `src/ipc.ts` registers handlers from 8+ modules, each with native dependencies. Testing at the IPC boundary would still require mocking everything below it.

4. **Three-tier strategy (pure unit / data integration / Playwright E2E)** — Selected. Sidesteps the native dependency problem entirely by testing pure logic directly, persistence layers with real files, and full app behavior through Electron's actual runtime.

5. **Docker-based test isolation** — Considered for parallel agent runs but rejected as over-engineered. Environment variable isolation with temp directories achieves the same result with zero infrastructure overhead.

## Root Cause

Testing was hard for this codebase for three interconnected reasons:

1. **Native code is interleaved with pure logic.** Functions like `parseDiff` and `parseShortstat` in `src/git.ts` are pure string parsers, but they lived in a module that also imports `child_process` for git operations and is consumed by IPC handlers that depend on Electron. Simply importing the module in a test context pulls in the entire native dependency chain.

2. **No seams for test isolation.** `src/projectSettings.ts` used a module-level cache with no way to reset state between tests. `src/scanner.ts` read hardcoded directory paths with no override mechanism. `src/main.ts` used Electron's `app.getPath('userData')` directly with no test hook.

3. **Single-process architecture with shared state.** Multiple test runs (especially from parallel AI agents) would collide on filesystem paths for project discovery, task metadata, project settings, and the hook server port.

## Solution

### Step 1: Export pure functions from mixed modules

In `src/git.ts`, `parseDiff` and `parseShortstat` were internal functions. They were exported so tests can import them directly without triggering native dependency chains:

```typescript
// src/git.ts — these were previously unexported
export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);
  for (const section of fileSections) {
    // ... pure string parsing logic
  }
  return files;
}

export function parseShortstat(raw: string): { filesChanged: number; insertions: number; deletions: number } {
  const m = raw.match(/(\d+) file.* changed(?:, (\d+) insertion)?(?:, (\d+) deletion)?/);
  return {
    filesChanged: m ? parseInt(m[1], 10) : 0,
    insertions: m?.[2] ? parseInt(m[2], 10) : 0,
    deletions: m?.[3] ? parseInt(m[3], 10) : 0,
  };
}
```

### Step 2: Write zero-mock unit tests for pure functions

```typescript
// src/__tests__/gitParsing.test.ts
import { describe, it, expect } from 'vitest';
import { parseDiff, parseShortstat } from '../git';

describe('parseDiff', () => {
  it('parses a single-file diff with additions and deletions', () => {
    const raw = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line1
-old line
+new line
+added line
 line3`;
    const result = parseDiff(raw);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('file.ts');
  });
});

describe('parseShortstat', () => {
  it('parses full stat line', () => {
    const result = parseShortstat(' 3 files changed, 10 insertions(+), 5 deletions(-)');
    expect(result).toEqual({ filesChanged: 3, insertions: 10, deletions: 5 });
  });
});
```

Similar tests for `sanitizeBranchName`/`generateBranchName` and `formatAge`.

### Step 3: Add test isolation seams to production code

Three minimal changes — the lightest possible seams:

```typescript
// src/projectSettings.ts — cache reset for test isolation
export function _resetCacheForTesting(): void {
  settingsCache.clear();
}
```

```typescript
// src/scanner.ts — env var override for project discovery
const testDirs = process.env.OUIJIT_TEST_SCAN_DIRS;
if (testDirs) return testDirs.split(':').filter(Boolean);
```

```typescript
// src/main.ts — env var override for userData path
const userDataPath = process.env.OUIJIT_TEST_USER_DATA || app.getPath('userData');
```

### Step 4: Write data layer integration tests with real persistence

```typescript
// src/__tests__/projectSettings.test.ts
describe('projectSettings lifecycle', () => {
  let projectPath: string;

  beforeEach(() => {
    _resetCacheForTesting();
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-test-'));
  });

  it('persists and loads settings through cache', () => {
    saveProjectSettings(projectPath, { sandboxEnabled: true, hooks: {} });
    _resetCacheForTesting(); // Force re-read from disk
    const reloaded = loadProjectSettings(projectPath);
    expect(reloaded.sandboxEnabled).toBe(true);
  });
});
```

### Step 5: Configure Playwright for Electron E2E

```typescript
// e2e/fixtures.ts — full isolation per test run
export function createTestRepo(name = 'test-project') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-'));
  const repoPath = path.join(tmpDir, name);
  fs.mkdirSync(repoPath, { recursive: true });
  execSync('git init && git add . && git commit -m "init"', { cwd: repoPath });
  return { repoPath, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

async function launchApp(scanDirs: string[]) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-e2e-userdata-'));
  const electronApp = await _electron.launch({
    args: [mainScript],
    env: {
      ...process.env,
      OUIJIT_TEST_USER_DATA: userDataDir,
      OUIJIT_TEST_SCAN_DIRS: scanDirs.join(':'),
      NODE_ENV: 'test',
    },
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { electronApp, page };
}
```

### Step 6: Exclude E2E from Vitest

```typescript
// vitest.config.ts
export default defineConfig({
  test: { exclude: ['e2e/**', 'node_modules/**'] },
});
```

### Parallel Agent Isolation Summary

Every shared resource has an isolation mechanism requiring zero coordination:

| Resource | Isolation Mechanism |
|----------|-------------------|
| Project discovery | `OUIJIT_TEST_SCAN_DIRS` env var per instance |
| Task metadata | `OUIJIT_TEST_USER_DATA` env var → unique temp dir |
| Project settings | Same `userData` isolation + `_resetCacheForTesting()` |
| Hook server port | `listen(0)` — OS-assigned ephemeral port |
| Git repos | `mkdtemp()` — unique temp dir per test |
| Electron instances | Each `launchApp()` creates independent process |

## Verification

1. **Unit tests pass with zero native dependencies loaded:** `npm test` runs all Tier 1 tests without triggering node-pty or koffi imports.
2. **Integration tests pass with real filesystem:** `projectSettings.test.ts` and `taskLifecycle.test.ts` use temp directories with real I/O.
3. **Type checking passes:** `npm run check` confirms all source changes are type-safe.
4. **E2E infrastructure compiles:** Playwright configuration, fixtures, and test specs build correctly.
5. **Parallel safety confirmed:** Running `npm test` from two agent worktrees simultaneously produces no failures or collisions.

## Prevention Strategies

### Maintaining coverage as the codebase grows

- **Pure functions (Tier 1):** Any new utility, parser, or formatter gets a unit test immediately. These are fast, stable, and cheap.
- **Data layer (Tier 2):** Any new module reading/writing to disk gets integration tests with temp directories. Do not mock the filesystem.
- **E2E (Tier 3):** Reserve for workflows spanning the full IPC bridge. Add sparingly — prefer pushing tests down to lower tiers.
- **Track gaps proactively:** When a production bug is found, ask "which tier should have caught this?" and fill the gap.

### Decision tree: new test vs rely on E2E

1. Is it a pure function? **Write a unit test. Always.**
2. Does it read/write files or manage persistent state? **Write an integration test with temp directories.**
3. Does it only matter in the full app lifecycle? **Consider E2E, but first try extracting testable logic.**
4. Is it IPC wiring, native module loading, or hotkey registration? **Leave to the "what NOT to test" list.**

Litmus test: if you need to mock more than two dependencies, you are testing at the wrong tier or the code needs refactoring.

### Keeping the "what NOT to test" list current

Review the exclusion list when:
- A new native dependency is added
- A module from the list gets complex enough that bugs appear in it
- The E2E suite grows beyond 30 seconds runtime

## Best Practices

### Electron apps with native dependencies

- Isolate native dependencies at the boundary (e.g., `ptyManager.ts` wraps node-pty)
- Test the logic around native calls (argument construction, result parsing), not the calls themselves
- Never import Electron or native modules in non-E2E tests
- Use `try/finally` in E2E tests to prevent leaked Electron processes

### Test isolation for parallel execution

- Environment variable injection is the key pattern — lightweight, zero infrastructure
- Each test creates its own temp directory via `mkdtemp()` — never use fixed paths
- Export cache reset functions (`_resetCacheForTesting()`) for state isolation
- Git repos in tests must be fully self-contained with their own config

### Making coupled code testable without over-engineering

Only 5 source files were modified. The pattern is deliberately minimal:
1. **Export** previously-private pure functions
2. **Add env var checks** at decision points (alternative path for tests)
3. **Export cache reset functions** (one-line, called only in `beforeEach`)
4. **Do not** introduce interfaces, DI frameworks, or abstractions solely for testing
5. **Use** Vitest's `vi.mock` for boundary mocking when needed

## Checklist for Future Changes

- [ ] Identify which test tier covers the module being changed
- [ ] Read existing tests to understand asserted invariants
- [ ] If adding a pure function: export it and write a unit test
- [ ] If adding file I/O: use env var overrides for test isolation
- [ ] If adding an in-memory cache: export a reset function
- [ ] If adding IPC handlers: delegate to separately testable functions
- [ ] Run `npm run check` (type checking)
- [ ] Run `npm test` (Tier 1 + Tier 2)
- [ ] For E2E changes: verify `launchApp`/`cleanupApp` lifecycle uses `try/finally`
- [ ] For E2E changes: verify no ordering dependencies between tests

## Related Documentation

- `TESTING-PLAN.md` — Full testing strategy and agent testing rules
- `docs/plans/2026-02-20-feat-testing-plan-v2-plan.md` — Comprehensive testing plan v2
- `docs/brainstorms/2026-02-20-testing-plan-v2-brainstorm.md` — Brainstorm/decision document
- `CLAUDE.md` — Project structure, code rules, test commands
- `README.md` — Project overview with development setup

### Source Changes for Testability

| File | Change |
|------|--------|
| `src/git.ts` | Exported `parseDiff` and `parseShortstat` |
| `src/projectSettings.ts` | Added `_resetCacheForTesting()` |
| `src/scanner.ts` | Added `OUIJIT_TEST_SCAN_DIRS` env var check |
| `src/main.ts` | Added `OUIJIT_TEST_USER_DATA` env var check |
| `vitest.config.ts` | Excluded `e2e/` directory |
| `package.json` | Added `test:e2e`, `test:full`, `test:e2e:ci` scripts |
