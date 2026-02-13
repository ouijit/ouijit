# Task-First Domain Model Refactor

## Context

The current domain model conflates **tasks** (the user's unit of work) with **worktrees** (the git implementation). Tasks are identified by branch name, IPC channels all use `worktree:*` for task operations, and the `TheatreTerminal` UI type carries `isWorktree`/`worktreeBranch`/`worktreePath` fields. The `readyToShip` boolean is a third status bolted onto a binary `open`/`closed` field.

This refactor makes Task the primary entity, introduces kanban statuses (`todo | in_progress | in_review | done`), and enables creating tasks without immediately allocating a worktree.

## Status Mapping

| Old State | New Status |
|---|---|
| *(new — no worktree)* | `todo` |
| `open` | `in_progress` |
| `open` + `readyToShip: true` | `in_review` |
| `closed` | `done` |

Status transitions are **unrestricted** — any status can move to any other status. The only side-effect is that moving to `in_progress` (or `in_review`) from `todo` triggers worktree creation if none exists.

---

## Phase 1: Data Model & Migration

Update core types and add automatic data migration.

### `src/taskMetadata.ts`
- Add `TaskStatus` type: `'todo' | 'in_progress' | 'in_review' | 'done'`
- Update `TaskMetadata.status` from `'open' | 'closed'` to `TaskStatus`
- Make `branch` optional (`branch?: string`) — `todo` tasks have no branch yet
- Add `worktreePath?: string` field — store the path on the task itself
- Remove `readyToShip` field (absorbed into `in_review` status)
- Add `schemaVersion` field to store root (outside the per-project map — use a wrapper type or reserved key like `__schemaVersion`)
- Add `migrateStore()` called from `loadStore()`:
  - `closed` → `done`
  - `open` + `readyToShip` → `in_review`
  - `open` → `in_progress`
  - Delete `readyToShip` from all tasks
  - Set `schemaVersion = 2`
- Switch all mutation functions from branch-based to taskNumber-based lookup:
  - `closeTask(projectPath, branch)` → `setTaskStatus(projectPath, taskNumber, status)`
  - `reopenTask(projectPath, branch)` → same `setTaskStatus`
  - `setTaskReadyToShip(...)` → delete (use `setTaskStatus(..., 'in_review')`)
  - `setTaskMergeTarget(projectPath, branch, ...)` → `setTaskMergeTarget(projectPath, taskNumber, ...)`
  - `setTaskSandboxed(projectPath, branch, ...)` → `setTaskSandboxed(projectPath, taskNumber, ...)`
  - `deleteTask(projectPath, branch)` → delete (use existing `deleteTaskByNumber`)
  - Keep `getTask(projectPath, branch)` as a convenience lookup
- Update `createTask` signature: `branch` becomes optional (for `todo` tasks)
- Update `getProjectTasks` sort: `todo` → `in_progress` → `in_review` → `done`, then by date

### `src/types.ts`
- Update `TaskMetadata` (lines 200-210): match changes above
- Replace `WorktreeWithMetadata` (lines 225-234) with `TaskWithWorkspace`:
  ```typescript
  interface TaskWithWorkspace {
    taskNumber: number;
    name: string;
    status: TaskStatus;
    branch?: string;
    worktreePath?: string;
    createdAt: string;
    closedAt?: string;
    mergeTarget?: string;
    prompt?: string;
    sandboxed?: boolean;
  }
  ```
  Keep `WorktreeWithMetadata` as a type alias temporarily.
- Add `taskId?: number` to `PtySpawnOptions` (line 117) and `ActiveSession` (line 146) — keep old fields for now
- Rename `WorktreeCreateResult` → `TaskCreateResult` (keep alias)

### Verify: `npm run check`

---

## Phase 2: Backend — Worktree Operations & IPC

Split task lifecycle from git worktree plumbing. Add new `task:*` IPC channels.

### `src/worktree.ts`
- Add `createTask(projectPath, name?, prompt?)` — creates task in `todo` status, no worktree, returns `TaskCreateResult`
- Add `startTask(projectPath, taskNumber, branchName?)` — transitions `todo` → `in_progress`: generates branch, creates worktree, updates task metadata with branch + worktreePath
- Keep `createTaskWorktree()` as the atomic "create + start" path (calls `createTask` then `startTask` internally)
- Remove `formatBranchNameForDisplay()` (line 249) — always use `task.name`
- Update `removeTaskWorktree` to also accept taskNumber lookup path

### `src/ipc.ts`
- Add new task lifecycle handlers:
  - `task:create` — create task in `todo` (no worktree)
  - `task:create-and-start` — create + worktree atomically (replaces `worktree:create`)
  - `task:start` — activate a `todo` task (creates worktree, sets `in_progress`)
  - `task:get-all` — returns `TaskWithWorkspace[]` (replaces `worktree:get-tasks`)
  - `task:set-status` — generic status setter, takes `taskNumber` + `TaskStatus` (replaces `worktree:close`, `worktree:reopen`, `worktree:set-ready`)
  - `task:delete` — delete task + worktree by taskNumber (replaces `worktree:remove` for tasks)
  - `task:set-merge-target` — takes taskNumber (replaces `worktree:set-merge-target`)
  - `task:set-sandboxed` — takes taskNumber (replaces `worktree:set-sandboxed`)
- Keep existing `worktree:*` handlers as deprecated aliases during transition
- Keep pure git-plumbing on `worktree:*`: `get-diff`, `get-file-diff`, `merge`, `ship`, `list`, `validate-branch-name`, `generate-branch-name`, `list-branches`, `get-main-branch`
- Update `worktree:ship` handler to use taskNumber internally for the close step

### Verify: `npm run check`

---

## Phase 3: Preload API

Expose `window.api.task` namespace alongside existing `window.api.worktree`.

### `src/preload.ts`
- Add `task:` namespace mirroring new IPC channels:
  - `create`, `createAndStart`, `start`, `getAll`, `setStatus`, `delete`, `setMergeTarget`, `setSandboxed`
- Keep `window.api.worktree` intact (deprecated for task ops, still used for git plumbing)

### `src/types.ts`
- Add `TaskAPI` interface with the new method signatures
- Add `task: TaskAPI` to the `ElectronAPI` interface (alongside existing `worktree`)

### Verify: `npm run check`

---

## Phase 4: Theatre State

Replace worktree fields on `TheatreTerminal` with `taskId`.

### `src/components/theatre/state.ts`
- On `TheatreTerminal` (line 14):
  - Remove: `isWorktree`, `worktreeBranch`, `readyToShip`
  - Keep: `worktreePath` (needed synchronously by `getTerminalGitPath`)
  - Add: `taskId: number | null` — null for non-task terminals

### `src/components/theatre/signals.ts`
- Rename `diffPanelWorktreeBranch` → `diffPanelTaskId` (type: `number | null`)

### `src/components/theatre/helpers.ts`
- `getTerminalGitPath` (line 98) still uses `term.worktreePath || term.projectPath` — no change needed

### `src/ptyManager.ts`
- Add `taskId?: number` to `ManagedPty` (line 7) and session serialization (line 221)
- Keep old fields during transition

### `src/types.ts`
- Mark `isWorktree`, `worktreeBranch` as `@deprecated` on `PtySpawnOptions` and `ActiveSession`

### Verify: `npm run check`

---

## Phase 5: Renderer Migration

Switch all renderer code from `window.api.worktree.*` to `window.api.task.*` for task operations.

### `src/components/theatre/terminalCards.ts`
- Replace `term.isWorktree && term.worktreeBranch` checks → `term.taskId != null`
- Replace `window.api.worktree.create(...)` → `window.api.task.createAndStart(...)`
- Replace `window.api.worktree.setSandboxed(path, branch, ...)` → `window.api.task.setSandboxed(path, taskNumber, ...)`
- Replace `window.api.worktree.getTasks(...)` → `window.api.task.getAll(...)`
- For close-task-from-terminal: `window.api.task.setStatus(path, term.taskId, 'done')`
- Set `taskId: task.taskNumber` when building TheatreTerminal objects
- Set `worktreePath` from result for `getTerminalGitPath` to work
- For env vars, look up task by `taskId` to get branch for `OUIJIT_TASK_BRANCH`
- Remove local `formatBranchNameForDisplay` usage — use `task.name`

### `src/components/theatre/taskIndex.ts`
- Replace `window.api.worktree.getTasks(...)` → `window.api.task.getAll(...)`
- Group tasks by kanban status (todo, in_progress, in_review, done) instead of binary open/closed
- Close: `window.api.task.setStatus(path, task.taskNumber, 'done')`
- Reopen: `window.api.task.setStatus(path, task.taskNumber, 'in_progress')`
- Delete: `window.api.task.delete(path, task.taskNumber)`
- When clicking a `todo` task: call `window.api.task.start(path, task.taskNumber)` to create worktree, then open terminal
- Remove local `formatBranchNameForDisplay` function

### `src/components/theatre/shipItPanel.ts`
- Replace `term.isWorktree || !term.worktreeBranch` → `!term.taskId`
- Find task by `t.taskNumber === term.taskId` instead of `t.branch === term.worktreeBranch`
- Get `branch` from task metadata for git diff/merge operations
- Close after ship: `window.api.task.setStatus(path, term.taskId, 'done')`
- Merge target: `window.api.task.setMergeTarget(path, term.taskId, branchName)`

### `src/components/theatre/worktreeDropdown.ts`
- Close task: `window.api.task.setStatus(path, task.taskNumber, 'done')`
- Match terminals by `term.taskId === task.taskNumber` instead of `term.worktreeBranch === task.branch`
- Reopen: `window.api.task.setStatus(path, task.taskNumber, 'in_progress')`
- Delete: `window.api.task.delete(path, task.taskNumber)`
- Pass `taskId` when opening terminals for existing tasks

### `src/components/theatre/diffPanel.ts`
- Replace `diffPanelWorktreeBranch` usage → `diffPanelTaskId`
- Look up branch from task metadata when calling `worktree:get-diff` (which takes a branch)

### `src/components/theatre/theatreMode.ts`
- Session reconnection: set `taskId` from `session.taskId` (or look up by branch for backwards compat with old sessions)

### `src/components/theatre/taskForm.ts`
- No major changes — form still collects name/prompt/branchName for `createAndStart`

### Verify: `npm run check`

---

## Phase 6: Cleanup

Remove all deprecated aliases, old fields, and dead code.

### `src/ipc.ts`
- Remove deprecated `worktree:*` handlers for task ops: `worktree:close`, `worktree:reopen`, `worktree:set-ready`, `worktree:set-merge-target`, `worktree:set-sandboxed`, `worktree:get-tasks`, `worktree:create`

### `src/preload.ts`
- Remove task methods from `window.api.worktree` namespace (keep git plumbing: `getDiff`, `getFileDiff`, `merge`, `ship`, `list`, `validateBranchName`, `generateBranchName`, `listBranches`, `getMainBranch`)

### `src/types.ts`
- Remove `WorktreeWithMetadata` alias
- Remove `WorktreeCreateResult` alias
- Remove `isWorktree`, `worktreeBranch` from `PtySpawnOptions` and `ActiveSession`
- Remove task methods from worktree API interface

### `src/taskMetadata.ts`
- Remove old branch-based functions: `closeTask`, `reopenTask`, `setTaskReadyToShip`, `deleteTask` (by branch), `ensureTaskExists`

### `src/worktree.ts`
- Remove `formatBranchNameForDisplay()`

### `src/ptyManager.ts`
- Remove `isWorktree`, `worktreeBranch` from `ManagedPty`

### `src/components/theatre/state.ts`
- Remove `isWorktree`, `worktreeBranch`, `readyToShip` from `TheatreTerminal`

### Verify: `npm run check`

---

## Files Modified (Summary)

| File | Phases |
|---|---|
| `src/taskMetadata.ts` | 1, 6 |
| `src/types.ts` | 1, 3, 4, 6 |
| `src/worktree.ts` | 2, 6 |
| `src/ipc.ts` | 2, 6 |
| `src/preload.ts` | 3, 6 |
| `src/ptyManager.ts` | 4, 6 |
| `src/components/theatre/state.ts` | 4, 6 |
| `src/components/theatre/signals.ts` | 4 |
| `src/components/theatre/helpers.ts` | 4 |
| `src/components/theatre/terminalCards.ts` | 5 |
| `src/components/theatre/taskIndex.ts` | 5 |
| `src/components/theatre/shipItPanel.ts` | 5 |
| `src/components/theatre/worktreeDropdown.ts` | 5 |
| `src/components/theatre/diffPanel.ts` | 5 |
| `src/components/theatre/theatreMode.ts` | 5 |

## Verification

After each phase: `npm run check` (TypeScript type checking).

After phase 5 (full migration complete): manual testing of:
- Create a new task (should work as before — `createAndStart`)
- Close a task from terminal card
- Reopen a closed task from task index
- Ship a task (merge + close)
- Delete a task
- Session restore after project switch
- Session reconnect after renderer reload
