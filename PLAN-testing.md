# Testing Plan (Pre-Migration)

## Context

No tests or test runner exist in the codebase. Before starting the domain migration, introduce minimal high-leverage tests that:
1. Act as a safety net during the migration — run after every phase to catch regressions
2. Are easy for AI agents to run (`npm test`) for self-validation
3. Cover the data layer that the migration rewrites most aggressively

## Infrastructure Setup

### Install Vitest

Vitest is the natural choice — already using Vite, zero additional config needed, runs TypeScript natively.

**`package.json`** changes:
- Add `vitest` to devDependencies
- Add `"test": "vitest run"` script
- Add `"test:watch": "vitest"` script (optional, for interactive dev)

**`CLAUDE.md`** changes:
- Add `npm test` to the commands section so AI agents know to run it

### Electron Mock Strategy

`taskMetadata.ts` imports `{ app } from 'electron'` for `app.getPath('userData')`. Rather than restructuring the module, mock `electron` in a Vitest setup file:

**New file: `src/__tests__/setup.ts`**
```typescript
import { vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Create a temp directory for each test run
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-test-'));

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return testDataDir;
      return testDataDir;
    },
  },
}));
```

**New file: `vitest.config.ts`** (at project root)
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/__tests__/setup.ts'],
    // Each test file gets a fresh module context (fresh storeCache)
    isolate: true,
  },
});
```

### File Structure

```
src/__tests__/
  setup.ts                    # Electron mock + temp dir
  taskMetadata.test.ts        # Test 1: CRUD lifecycle
  taskMetadata.migration.test.ts  # Test 2: Schema migration (added during Phase 1)
```

---

## Test 1: Task Metadata CRUD Lifecycle

**File:** `src/__tests__/taskMetadata.test.ts`

This is the highest-leverage test. It exercises the entire `taskMetadata.ts` API surface that the migration rewrites. Run it after every phase — if it passes, the data layer is intact.

**What it covers:**

```
describe('taskMetadata', () => {
  // Fresh temp dir per test (from setup.ts mock)

  test('createTask and getProjectTasks round-trip', () => {
    // Create a task with all fields
    // Verify it appears in getProjectTasks
    // Verify all fields are correct
    // Verify nextTaskNumber incremented
  });

  test('getTask looks up by branch', () => {
    // Create task with known branch
    // getTask(projectPath, branch) returns it
    // getTask with unknown branch returns null
  });

  test('getTaskByNumber looks up by taskNumber', () => {
    // Create task with known number
    // getTaskByNumber returns it
    // Unknown number returns null
  });

  test('closeTask and reopenTask toggle status', () => {
    // Create open task
    // closeTask → status is 'closed', closedAt is set
    // reopenTask → status is 'open', closedAt is deleted
  });

  test('setTaskReadyToShip toggles the flag', () => {
    // Create task
    // setTaskReadyToShip(true) → readyToShip is true
    // setTaskReadyToShip(false) → readyToShip deleted
  });

  test('setTaskMergeTarget persists', () => {
    // Create task
    // setTaskMergeTarget('develop')
    // Verify it reads back correctly
  });

  test('setTaskSandboxed toggles the flag', () => {
    // Create task
    // setTaskSandboxed(true) → sandboxed is true
    // setTaskSandboxed(false) → sandboxed deleted
  });

  test('deleteTaskByNumber removes the task', () => {
    // Create task
    // deleteTaskByNumber
    // getTaskByNumber returns null
  });

  test('getProjectTasks sorts open before closed', () => {
    // Create multiple tasks in different states
    // Verify sort order: open first (newest first), then closed (newest first)
  });

  test('multiple projects are isolated', () => {
    // Create tasks under /project-a and /project-b
    // Verify getProjectTasks for each returns only its own tasks
  });
});
```

**Why this test is high-leverage for the migration:**
- Phase 1 rewrites every mutation function signature (branch → taskNumber). This test catches if any CRUD operation breaks.
- After Phase 1, this test gets updated to use the new signatures (taskNumber-based). It then validates every subsequent phase doesn't regress the data layer.
- AI agents can run `npm test` as a quick sanity check — faster and more reliable than manual testing.

---

## Test 2: Schema Migration (Added During Migration Phase 1)

**File:** `src/__tests__/taskMetadata.migration.test.ts`

This test is *written during Phase 1* of the migration, alongside the `migrateStore()` function. It's planned here so the migration phase knows to include it.

**What it covers:**

```
describe('schema migration v1 → v2', () => {
  test('migrates open tasks to in_progress', () => {
    // Write v1 JSON directly: { status: 'open' }
    // Load store (triggers migration)
    // Verify status is 'in_progress'
  });

  test('migrates open+readyToShip to in_review', () => {
    // Write v1 JSON: { status: 'open', readyToShip: true }
    // Load → verify status is 'in_review', readyToShip deleted
  });

  test('migrates closed to done', () => {
    // Write v1 JSON: { status: 'closed', closedAt: '...' }
    // Load → verify status is 'done', closedAt preserved
  });

  test('migration is idempotent', () => {
    // Write v1 JSON, load (migrates), save
    // Clear cache, load again
    // Verify no double-migration, same result
  });

  test('sets schemaVersion on migrated store', () => {
    // Write v1 JSON (no schemaVersion)
    // Load → verify schemaVersion is 2
  });
});
```

**Why this test is high-leverage:**
- The migration runs exactly once on real user data. If it's wrong, users lose task state with no recovery. This test catches mapping errors before that happens.
- It validates the idempotency guarantee — critical since the migration triggers on every `loadStore()` until the version is bumped.

---

## Updated CLAUDE.md Commands

After setup, the commands section becomes:

```
- `npm run check` - Type check (run this to verify changes)
- `npm test` - Run tests (run this to validate data layer changes)
```

---

## Verification

After implementing the test infrastructure + Test 1:
- `npm test` passes with all tests green
- `npm run check` still passes (no type errors introduced)
- Tests run in < 2 seconds (no Electron startup, no git operations)
